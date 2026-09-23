import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ApiClientService } from '../../core/api/api-client.service';
import { AuthProvider, AuthService } from '../../core/auth/auth.service';
import { AuthProviderButtonsComponent } from '../../shared/auth-provider-buttons/auth-provider-buttons.component';
import { CodeInputComponent } from '../../shared/code-input/code-input.component';
import { I18nService } from '../../core/services/i18n.service';
import { TranslatePipe } from '../../shared/translate.pipe';

type ClaimState =
  'idle' | 'confirming' | 'done' | 'invalid' | 'rateLimited' | 'browserSessionRequired' | 'error';

/** Réponse de `GET /api/v1/auth/native/pairing?code=` (functions/api/v1/auth/native/pairing.ts). */
interface PairingInfo {
  pairingCode: string;
  requestedAt: string;
  ageSeconds: number;
  expiresAt: string;
  expiresInSeconds: number;
  /** Code pays ISO à deux lettres (Cloudflare), `XX` inconnu, `T1` Tor, ou `null`. */
  country: string | null;
  /** User-agent de l'appareil demandeur, tronqué à 200 caractères côté serveur, ou `null`. */
  userAgent: string | null;
}

/** Détails de la demande : chargés, en cours, introuvable (404, code faux/expiré/déjà utilisé)
 * ou indisponibles (autre échec : réseau, 429... — la confirmation reste alors possible). */
type InfoState =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'loaded'; info: PairingInfo }
  | { kind: 'notFound' }
  | { kind: 'browserSessionRequired' }
  | { kind: 'unavailable' };

/** Longueur exacte d'un code d'appairage (`USER_CODE_LENGTH`, server/auth/pairing.ts) : le serveur
 * refuse (400) tout autre format, inutile de l'interroger avant. */
const CODE_LENGTH = 8;
/** Délai après la dernière frappe avant de demander les détails (évite une requête par touche). */
const INFO_DEBOUNCE_MS = 300;

/**
 * Page d'appairage d'un client natif (overlay, lot L4 de `wakfu-companion-overlay` —
 * `docs/plan-architecture.md` §7.2 de ce dépôt). Volontairement HORS du système i18n/
 * `NavigationService` (voir app.routes.ts) : ce n'est pas une vue du tableau de bord mais un écran
 * ponctuel type "device flow".
 *
 * **Anti-hameçonnage (audit sécurité du 2026-09-23)** : un flux « device code » est la cible
 * classique d'un hameçonnage — un tiers lance lui-même un appairage, puis envoie à la victime le
 * lien `/pair?code=SON_CODE` ; un simple clic sur « Confirmer » lui donnait alors un jeton sur le
 * compte de la victime. Désormais :
 * - le `?code=` de l'URL est **ignoré** (ni affiché, ni pré-rempli, retiré de la barre d'adresse)
 *   — l'utilisateur doit RESAISIR le code affiché sur SON overlay, ce qu'une victime qui n'a lancé
 *   aucun overlay ne peut pas faire sans qu'on le lui dicte ;
 * - un avertissement explicite dit de ne jamais confirmer un code reçu par message ;
 * - une fois le code saisi, la page affiche le pays, l'appareil (user-agent) et l'âge de la demande
 *   (`GET /api/v1/auth/native/pairing`) AVANT le bouton Confirmer — de quoi repérer une demande
 *   lancée ailleurs. Code inconnu/expiré (404) : confirmation impossible ; autre échec (réseau,
 *   429) : détails signalés indisponibles, confirmation toujours possible.
 */
@Component({
  selector: 'app-native-pair',
  imports: [TranslatePipe, AuthProviderButtonsComponent, CodeInputComponent],
  templateUrl: './native-pair.component.html',
  styleUrl: './native-pair.component.css',
})
export class NativePairComponent implements OnDestroy {
  private readonly api = inject(ApiClientService);
  private readonly i18n = inject(I18nService);
  protected readonly auth = inject(AuthService);

  protected readonly codeLength = CODE_LENGTH;
  /** Code RESAISI par l'utilisateur — jamais initialisé depuis l'URL (voir doc de la classe). */
  protected readonly code = signal('');
  protected readonly state = signal<ClaimState>('idle');
  protected readonly infoState = signal<InfoState>({ kind: 'none' });
  /** Confirmation possible seulement une fois les détails de la demande consultés (ou
   * indisponibles) : jamais pendant leur chargement, ni pour un code que le serveur ne connaît pas. */
  protected readonly canConfirm = computed(() => {
    const info = this.infoState().kind;
    return (
      this.code().length === CODE_LENGTH &&
      this.state() !== 'confirming' &&
      (info === 'loaded' || info === 'unavailable')
    );
  });
  protected readonly loadedInfo = computed(() => {
    const info = this.infoState();
    return info.kind === 'loaded' ? info.info : null;
  });

  private infoTimer: ReturnType<typeof setTimeout> | null = null;
  /** Numéro de la dernière requête de détails : une réponse plus ancienne est ignorée. */
  private infoRequest = 0;

  constructor() {
    this.stripCodeFromUrl();
  }

  ngOnDestroy(): void {
    if (this.infoTimer !== null) clearTimeout(this.infoTimer);
  }

  protected onCodeChange(value: string): void {
    this.code.set(value);
    // Une nouvelle saisie efface le message d'échec précédent (sauf pendant l'envoi).
    if (this.state() !== 'confirming' && this.state() !== 'done') this.state.set('idle');
    this.scheduleInfo(value);
  }

  /** Pays lisible (nom dans la langue courante) à partir du code ISO fourni par Cloudflare. */
  protected countryLabel(country: string | null): string {
    if (!country || country === 'XX') return this.i18n.t('nativePair.info.unknown');
    if (country === 'T1') return this.i18n.t('nativePair.info.tor');
    try {
      const names = new Intl.DisplayNames([this.i18n.locale()], { type: 'region' });
      const name = names.of(country);
      return name && name !== country ? `${name} (${country})` : country;
    } catch {
      return country;
    }
  }

  /** Âge de la demande, arrondi à la minute au-delà de 60 s. */
  protected ageLabel(seconds: number): string {
    if (seconds < 60) return this.i18n.t('nativePair.info.ageSeconds', { n: Math.max(0, seconds) });
    return this.i18n.t('nativePair.info.ageMinutes', { n: Math.floor(seconds / 60) });
  }

  private scheduleInfo(code: string): void {
    if (this.infoTimer !== null) clearTimeout(this.infoTimer);
    this.infoTimer = null;
    this.infoRequest += 1;
    if (code.length !== CODE_LENGTH || !this.auth.isAuthenticated()) {
      this.infoState.set({ kind: 'none' });
      return;
    }
    this.infoState.set({ kind: 'loading' });
    const request = this.infoRequest;
    this.infoTimer = setTimeout(() => {
      this.infoTimer = null;
      void this.loadInfo(code, request);
    }, INFO_DEBOUNCE_MS);
  }

  private async loadInfo(code: string, request: number): Promise<void> {
    const result = await this.api.getJson<PairingInfo>(
      `/auth/native/pairing?code=${encodeURIComponent(code)}`,
      { retries: 0 },
    );
    if (request !== this.infoRequest) return; // saisie modifiée entre-temps
    if (result.ok) {
      this.infoState.set({ kind: 'loaded', info: result.data });
      return;
    }
    const status = result.error.kind === 'http' ? result.error.status : undefined;
    if (status === 404 || status === 400) this.infoState.set({ kind: 'notFound' });
    else if (status === 403 && result.error.code === 'browser_session_required')
      this.infoState.set({ kind: 'browserSessionRequired' });
    else this.infoState.set({ kind: 'unavailable' });
  }

  protected login(provider: AuthProvider): void {
    this.auth.clearError();
    // Retour sur `/pair` SANS code : le code est de toute façon à resaisir.
    this.auth.login(provider, '/pair');
  }

  protected async confirm(): Promise<void> {
    if (!this.canConfirm()) return;
    this.state.set('confirming');
    const result = await this.api.requestJson<{ ok: true }>('/auth/native/claim', {
      method: 'POST',
      body: { pairingCode: this.code() },
    });
    if (result.ok) {
      this.state.set('done');
      return;
    }
    const status = result.error.kind === 'http' ? result.error.status : undefined;
    if (status === 403 && result.error.code === 'browser_session_required')
      this.state.set('browserSessionRequired');
    else if (status === 429) this.state.set('rateLimited');
    else if (status !== undefined && status >= 400 && status < 500) this.state.set('invalid');
    else this.state.set('error');
  }

  /** Retire `?code=` de la barre d'adresse : le laisser visible servirait d'« indice » à recopier,
   * exactement ce que la resaisie cherche à empêcher pour un lien reçu d'un tiers. */
  private stripCodeFromUrl(): void {
    if (typeof location === 'undefined' || typeof history === 'undefined') return;
    const params = new URLSearchParams(location.search);
    if (!params.has('code')) return;
    params.delete('code');
    const query = params.toString();
    history.replaceState(
      history.state,
      '',
      `${location.pathname}${query ? `?${query}` : ''}${location.hash}`,
    );
  }
}
