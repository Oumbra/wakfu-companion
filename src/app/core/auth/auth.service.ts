import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';
import { UserDataService } from '../data-access/user-data.service';
import type { UserDataKey } from '../data-access/user-data.keys';
import { AppDataExportService } from '../services/app-data-export.service';
import { HistoryArchiveService } from '../sync/history-archive.service';
import { HistorySyncService } from '../sync/history-sync.service';

/**
 * État de session côté client (lot 5, prompt 5.2) — voir
 * docs/plan-migration-serveur.md §7 et server/README.md pour le versant
 * serveur.
 *
 * Principe directeur, non négociable : **la connexion est optionnelle**.
 * `'guest'` n'est pas un état d'erreur mais le mode par défaut, dans lequel
 * l'application fonctionne exactement comme avant ce lot (toutes les données
 * en `localStorage`). Aucune garde de route, aucune fonctionnalité réservée.
 * Un 401 sur `/auth/me` — le cas le plus courant — fait simplement passer en
 * `'guest'`.
 *
 * Le jeton de session n'est JAMAIS manipulé ici : il vit dans un cookie
 * `httpOnly` invisible du JavaScript (§7). Ce service ne connaît que l'état
 * dérivé des réponses de l'API.
 */

export type AuthStatus = 'unknown' | 'guest' | 'authenticated';

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface AuthIdentity {
  provider: 'discord' | 'google';
  linkedAt: string;
}

export interface AuthSessionInfo {
  id: string;
  current: boolean;
  issuedAt: string;
  lastUsedAt: string;
  expiresAt: string;
  userAgent: string | null;
}

export type AuthProvider = 'discord' | 'google';

/** Résultat du retour OAuth lu dans l'URL (`?login=ok|error`), voir functions/api/v1/auth/…/callback.ts. */
export interface LoginOutcome {
  status: 'ok' | 'error';
  /** Code d'erreur brut du serveur (`cancelled`, `invalid_state`, …) — traduit à l'affichage. */
  reason: string | null;
  /** Vrai quand le compte vient d'être créé (`?first=1`). */
  isNewAccount: boolean;
}

/** Décision attendue de l'utilisateur quand données locales et données de compte coexistent. */
export type DataMigrationChoice = 'upload' | 'download';

export interface RemoteSettings {
  hasData: boolean;
  keys: string[];
  data: Record<string, unknown>;
  updatedAt: string | null;
  /** Horodatage par clé (lot 6) — indispensable à l'arbitrage « dernier écrivain gagne ». */
  updatedAtByKey?: Partial<Record<UserDataKey, string>>;
}

/** Décision de migration en attente — voir `AuthService.evaluateDataMigration`. */
export interface MigrationPrompt {
  kind: 'upload' | 'download' | 'conflict';
  remote: RemoteSettings;
}

/** Voir `AuthService.markMobileSkipLoginPending`/`consumeMobileSkipLoginPending`. */
const MOBILE_SKIP_LOGIN_STORAGE_KEY = 'wakfu-mobile-skip-login-pending';

/** Codes d'erreur renvoyés par le callback serveur (`?reason=`) traduits en clés i18n. */
function loginErrorKey(reason: string | null): string {
  switch (reason) {
    case 'cancelled':
      return 'auth.error.cancelled';
    case 'invalid_state':
    case 'provider_mismatch':
      return 'auth.error.state';
    case 'rate_limited':
      return 'auth.error.rateLimited';
    default:
      return 'auth.error.generic';
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClientService);
  private readonly dataExport = inject(AppDataExportService);
  private readonly userData = inject(UserDataService);
  private readonly historySync = inject(HistorySyncService);
  private readonly historyArchive = inject(HistoryArchiveService);

  private readonly _status = signal<AuthStatus>('unknown');
  private readonly _user = signal<AuthUser | null>(null);
  private readonly _identities = signal<readonly AuthIdentity[]>([]);
  /** Vrai quand une requête d'authentification est en vol (connexion, déconnexion, migration). */
  private readonly _busy = signal(false);
  /** Clé i18n de la dernière erreur (échec de connexion, échec de synchro) — jamais un simple « non connecté ». */
  private readonly _error = signal<string | null>(null);
  private readonly _loginOutcome = signal<LoginOutcome | null>(null);
  private readonly _migrationPrompt = signal<MigrationPrompt | null>(null);

  readonly status = this._status.asReadonly();
  readonly user = this._user.asReadonly();
  readonly identities = this._identities.asReadonly();
  readonly busy = this._busy.asReadonly();
  readonly error = this._error.asReadonly();
  readonly loginOutcome = this._loginOutcome.asReadonly();
  readonly migrationPrompt = this._migrationPrompt.asReadonly();
  readonly isAuthenticated = computed(() => this._status() === 'authenticated');

  /** État de la synchronisation de configuration (lot 6) — `'idle'` en mode invité. */
  readonly syncState = this.userData.syncState;
  readonly syncPendingKeys = this.userData.pendingKeys;
  readonly lastSyncedAt = this.userData.lastSyncedAt;

  constructor() {
    // Équivalent de l'intercepteur HTTP demandé par le prompt 5.2 : tout 401
    // renvoyé par n'importe quel appel API (pas seulement ceux de ce service)
    // fait retomber l'application en mode invité, proprement.
    this.api.setUnauthorizedHandler(() => this.becomeGuest());
  }

  /**
   * Appelé une fois au démarrage. Ne bloque rien : tant que la réponse n'est
   * pas là, l'état reste `'unknown'` et l'application s'affiche normalement.
   */
  async loadCurrentUser(): Promise<void> {
    const result = await this.api.getJson<{ user: AuthUser; identities: AuthIdentity[] }>(
      '/auth/me',
      // Pas de retry : un 401 est une réponse parfaitement normale ici (mode
      // invité), inutile d'insister, et la latence de démarrage compte.
      { retries: 0 },
    );
    if (result.ok) {
      this._user.set(result.data.user);
      this._identities.set(result.data.identities);
      this._status.set('authenticated');
      // Historique fusionné (voir HistoryArchiveService) : charge l'archive dès qu'on sait la
      // session déjà active au démarrage (pas seulement après un login fraîchement effectué,
      // voir les 2 autres appels sur ce même service plus bas).
      void this.historyArchive.loadAll();
      return;
    }
    this.becomeGuest();
  }

  /**
   * Démarre le flux OAuth : navigation vers l'API, qui redirige vers le
   * fournisseur. Volontairement une navigation complète (`location.assign`) et
   * non un `fetch` — un flux OAuth est une redirection de navigateur, pas un
   * appel XHR.
   */
  login(provider: AuthProvider, redirectTo?: string): void {
    const target = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
    location.assign(`/api/v1/auth/${provider}/start${target}`);
  }

  async logout(): Promise<boolean> {
    this._busy.set(true);
    const result = await this.api.requestJson<{ ok: boolean }>('/auth/logout', { method: 'POST' });
    this._busy.set(false);
    // Même si l'appel échoue côté réseau, on retombe en invité côté client :
    // rester affiché comme connecté alors que l'utilisateur a demandé à partir
    // serait le pire des deux mondes.
    this.becomeGuest();
    return result.ok;
  }

  async listSessions(): Promise<AuthSessionInfo[] | null> {
    const result = await this.api.getJson<{ sessions: AuthSessionInfo[] }>('/auth/sessions', {
      retries: 0,
    });
    // Un 401 est déjà traité globalement (voir le constructeur).
    return result.ok ? result.data.sessions : null;
  }

  /** Révoque une session précise, ou toutes (`id` omis) — voir functions/api/v1/auth/sessions.ts. */
  async revokeSession(id?: string): Promise<boolean> {
    this._busy.set(true);
    const query = id ? `?id=${encodeURIComponent(id)}` : '';
    const result = await this.api.requestJson<{ revoked: number; loggedOut: boolean }>(
      `/auth/sessions${query}`,
      { method: 'DELETE' },
    );
    this._busy.set(false);
    if (!result.ok) return false;
    if (result.data?.loggedOut) this.becomeGuest();
    return true;
  }

  async deleteAccount(): Promise<boolean> {
    this._busy.set(true);
    const result = await this.api.requestJson<{ deleted: boolean }>('/auth/account', {
      method: 'DELETE',
    });
    this._busy.set(false);
    if (!result.ok) return false;
    this.becomeGuest();
    return true;
  }

  /**
   * Séquence de démarrage : lit le retour OAuth éventuel, charge l'utilisateur
   * courant, et prépare la décision de migration des données locales quand une
   * connexion vient d'aboutir.
   *
   * Rien de tout cela ne bloque l'affichage : un invité (le cas courant) ne
   * subit qu'un `GET /auth/me` qui répond 401.
   */
  async handleStartup(): Promise<LoginOutcome | null> {
    const outcome = this.consumeLoginOutcome();
    if (outcome?.status === 'error') this._error.set(loginErrorKey(outcome.reason));

    await this.loadCurrentUser();

    if (outcome?.status === 'ok' && this.isAuthenticated()) {
      await this.evaluateDataMigration();
    }
    // Synchronisation de la configuration (lot 6) — jamais tant qu'une
    // décision de migration est en attente : arbitrer clé par clé pendant
    // qu'on demande encore à l'utilisateur quelle source garder reviendrait à
    // fusionner en silence, ce que le prompt 5.2 interdit.
    if (this.isAuthenticated() && !this._migrationPrompt()) {
      await this.userData.activateRemote();
      await this.activateHistorySync();
    }
    this._loginOutcome.set(outcome);
    return outcome;
  }

  /**
   * Détermine ce qu'il faut demander à l'utilisateur à propos de ses données,
   * sans jamais rien décider à sa place (prompt 5.2 point 5 : « ne fusionne
   * jamais en silence ») :
   *
   * | Local | Compte | Proposition            |
   * | ----- | ------ | ---------------------- |
   * | vide  | vide   | rien à demander        |
   * | plein | vide   | téléverser (`upload`)  |
   * | vide  | plein  | récupérer (`download`) |
   * | plein | plein  | choisir (`conflict`)   |
   */
  async evaluateDataMigration(): Promise<void> {
    const remote = await this.fetchRemoteSettings();
    if (!remote) return;

    const hasLocal = this.hasLocalData();
    if (!hasLocal && !remote.hasData) {
      this._migrationPrompt.set(null);
      return;
    }
    const kind = !remote.hasData ? 'upload' : !hasLocal ? 'download' : 'conflict';
    this._migrationPrompt.set({ kind, remote });
  }

  /** Applique la décision de migration. `download` recharge la page (même
   * raison qu'un import de fichier : les signaux en mémoire de chaque service
   * doivent repartir des nouvelles valeurs, voir AppDataExportService). */
  async resolveMigration(choice: DataMigrationChoice): Promise<boolean> {
    const prompt = this._migrationPrompt();
    if (!prompt) return false;

    if (choice === 'upload') {
      const ok = await this.uploadLocalData();
      if (!ok) return false;
      this._migrationPrompt.set(null);
      await this.userData.activateRemote();
      await this.activateHistorySync();
      return true;
    }

    this.applyRemoteData(prompt.remote);
    this._migrationPrompt.set(null);
    location.reload();
    return true;
  }

  dismissMigration(): void {
    this._migrationPrompt.set(null);
  }

  /**
   * Synchronisation manuelle (bouton de la page compte) : envoie ce qui est en
   * attente, puis se réaligne sur le compte. Utile quand une synchronisation
   * automatique a échoué (hors-ligne) et que l'utilisateur veut réessayer sans
   * attendre la prochaine modification.
   *
   * Sans effet en mode invité — c'est la définition même de ce mode : aucune
   * donnée ne part du navigateur.
   */
  async syncNow(): Promise<boolean> {
    if (!this.isAuthenticated()) return false;
    this._busy.set(true);
    await this.userData.flush();
    await this.userData.activateRemote();
    // L'historique (lot 8) suit le même bouton : c'est la même promesse faite à
    // l'utilisateur — « envoie ce qui n'est pas encore parti ».
    await this.historySync.flush();
    this._busy.set(false);
    const ok = this.userData.syncState() !== 'error';
    if (!ok) this._error.set('auth.error.sync');
    return ok;
  }

  // ── Données du compte (base de la migration du prompt 5.2 point 5) ──────

  async fetchRemoteSettings(): Promise<RemoteSettings | null> {
    const result = await this.api.getJson<RemoteSettings>('/settings', { retries: 0 });
    return result.ok ? result.data : null;
  }

  /** Téléverse les données locales vers le compte (remplacement complet, jamais une fusion). */
  async uploadLocalData(): Promise<boolean> {
    this._busy.set(true);
    const payload = this.dataExport.buildExport();
    const result = await this.api.requestJson<{ saved: number; updatedAt: string }>('/settings', {
      method: 'PUT',
      body: { data: payload.data },
    });
    this._busy.set(false);
    if (!result.ok) {
      this._error.set('auth.error.sync');
      return false;
    }
    // Aligner les horodatages locaux sur celui du serveur : sans ça, la copie
    // locale paraîtrait plus récente que ce qu'elle vient d'envoyer et
    // repartirait inutilement à la synchronisation suivante (lot 6).
    const uploadedAt = new Date(result.data?.updatedAt ?? Date.now());
    this.userData.markUploaded(Number.isNaN(uploadedAt.getTime()) ? new Date() : uploadedAt);
    return true;
  }

  /**
   * Écrase les données locales par celles du compte, **en conservant les
   * horodatages du serveur** (lot 6) : une valeur récupérée du compte ne doit
   * pas ressortir comme une modification locale toute fraîche à la
   * synchronisation suivante.
   */
  applyRemoteData(remote: RemoteSettings): void {
    this.userData.applyAccountSnapshot(
      remote.data as Partial<Record<UserDataKey, unknown>>,
      remote.updatedAtByKey,
    );
  }

  /** Vrai s'il existe des données locales qui vaudraient la peine d'être téléversées. */
  hasLocalData(): boolean {
    return Object.keys(this.dataExport.buildExport().data).length > 0;
  }

  // ── Retour OAuth ────────────────────────────────────────────────────────

  /**
   * Lit `?login=…` posé par le callback serveur, puis **nettoie l'URL**
   * (`history.replaceState`) : sans ça, un rechargement ou un partage de
   * l'URL rejouerait indéfiniment le même message de connexion.
   */
  consumeLoginOutcome(): LoginOutcome | null {
    const params = new URLSearchParams(location.search);
    const login = params.get('login');
    if (login !== 'ok' && login !== 'error') return null;

    const outcome: LoginOutcome = {
      status: login,
      reason: params.get('reason'),
      isNewAccount: params.get('first') === '1',
    };

    params.delete('login');
    params.delete('reason');
    params.delete('first');
    const query = params.toString();
    history.replaceState(
      null,
      '',
      `${location.pathname}${query ? `?${query}` : ''}${location.hash}`,
    );

    return outcome;
  }

  clearError(): void {
    this._error.set(null);
  }

  /**
   * Marque l'intention de "passer" la connexion d'un fichier de log (bouton mobile de la page
   * setup, voir SetupComponent) juste avant de lancer le flux OAuth (`login()`, une navigation
   * complète du navigateur). Persisté en `sessionStorage` — seul moyen de survivre à cet
   * aller-retour : `login()` navigue hors de l'application, tout état en mémoire (y compris
   * `SetupComponent` lui-même) est perdu, le retour recharge l'app de zéro (voir `App.ngOnInit`,
   * qui consomme ce flag une fois `handleStartup()` résolu). Jamais en `localStorage` : cette
   * intention est ponctuelle, elle n'a aucune raison de survivre au-delà de cet onglet.
   */
  markMobileSkipLoginPending(): void {
    try {
      sessionStorage.setItem(MOBILE_SKIP_LOGIN_STORAGE_KEY, '1');
    } catch {
      // Stockage indisponible (navigation privée stricte...) : dégradation mineure, l'utilisateur
      // atterrit simplement sur la page compte au lieu du tableau de bord après connexion.
    }
  }

  /** Lu une seule fois au retour du flux OAuth (voir `App.ngOnInit`) — nettoie le flag dans tous
   * les cas, y compris quand le stockage est indisponible. */
  consumeMobileSkipLoginPending(): boolean {
    try {
      const pending = sessionStorage.getItem(MOBILE_SKIP_LOGIN_STORAGE_KEY) === '1';
      sessionStorage.removeItem(MOBILE_SKIP_LOGIN_STORAGE_KEY);
      return pending;
    } catch {
      return false;
    }
  }

  /**
   * Retour au mode invité : session expirée, révoquée depuis un autre
   * appareil, déconnexion volontaire ou compte supprimé. L'application reste
   * pleinement fonctionnelle dans cet état — c'est le mode par défaut, pas une
   * dégradation.
   */
  /**
   * Active la file d'envoi des historiques (lot 8). L'identifiant du compte
   * entre dans la clé déterministe de chaque événement, d'où l'attente que la
   * session soit résolue avant de démarrer la file.
   */
  private async activateHistorySync(): Promise<void> {
    const user = this._user();
    if (!user) return;
    await this.historySync.enable(user.id);
  }

  private becomeGuest(): void {
    this._user.set(null);
    this._identities.set([]);
    this._status.set('guest');
    // La file d'historique cesse d'être alimentée et vidée ; son contenu reste
    // sur le disque, prêt à repartir à la prochaine connexion au même compte.
    this.historySync.disable();
    // L'archive déjà chargée, elle, appartient au compte qu'on vient de
    // quitter : la garder affichée serait montrer les données d'une session
    // révoquée.
    this.historyArchive.reset();
    // Retour au stockage purement local — les données déjà présentes sur cet
    // appareil restent intactes et utilisables (mode invité, §7 du plan).
    this.userData.deactivateRemote();
  }
}
