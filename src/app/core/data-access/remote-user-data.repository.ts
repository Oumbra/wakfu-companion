import { Injectable, inject, signal } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';
import { LocalUserDataRepository } from './local-user-data.repository';
import { buildUserDataPatch, isMergeableUserDataKey } from './user-data-patch.util';
import { USER_DATA_KEY_LIST, type UserDataKey } from './user-data.keys';
import type { UserDataRepository } from './user-data.repository';

/** Délai d'écriture décalée (prompt 6.1 point 5) : un incrément de compteur de
 * suivi ne doit pas déclencher une requête à lui tout seul. */
const WRITE_DEBOUNCE_MS = 1_500;

export type SyncState = 'idle' | 'pending' | 'syncing' | 'error';

/** Réponse de `PATCH /api/v1/settings` (voir functions/api/v1/settings.ts). */
interface PatchResponse {
  /** `value` n'est renseignée que pour une écriture partielle : la valeur entière fusionnée. */
  applied: { key: UserDataKey; updatedAt: string; value?: unknown }[];
  rejected: { key: UserDataKey; remoteUpdatedAt: string; value: unknown }[];
}

/** Une entrée du corps de `PATCH` : valeur entière, ou correctif partiel (clés fusionnables). */
type PatchEntry =
  | { key: UserDataKey; value: unknown; updatedAt: string }
  | { key: UserDataKey; patch: unknown; updatedAt: string };

/** Réponse de `GET /api/v1/settings`. */
interface SettingsResponse {
  data: Partial<Record<UserDataKey, unknown>>;
  updatedAtByKey?: Partial<Record<UserDataKey, string>>;
}

/**
 * Mode connecté : la copie locale reste la source de vérité immédiate (lecture
 * synchrone, voir `UserDataRepository`), doublée d'une réplication vers le
 * compte.
 *
 * Trois moments, et un seul arbitre — l'horodatage par clé :
 *
 * 1. **`pull()`** au démarrage / à la connexion : pour chaque champ, la
 *    version la plus récente gagne. Une version distante plus récente est
 *    écrite localement (et les services concernés en sont avertis) ; une
 *    version locale plus récente part vers le compte.
 * 2. **`write()`** : écrit localement tout de suite, note le champ comme en
 *    attente et programme un envoi groupé différé.
 * 3. **`flush()`** : envoie le lot. Le serveur ré-arbitre (un autre appareil a
 *    pu écrire entre-temps) et renvoie les champs refusés avec la version
 *    conservée — appliquée localement sans second aller-retour.
 *
 * Aucune écriture n'est jamais perdue faute de réseau : elle est déjà en
 * `localStorage`, et le champ reste marqué en attente jusqu'à un envoi réussi.
 *
 * ## Écritures partielles
 *
 * Pour `profile` et `roster` (voir `user-data-patch.util.ts`), l'envoi ne
 * porte que la différence avec la dernière version que le serveur détient
 * (`acked`, tenue à jour à chaque réponse du compte) — un réglage d'alerte ne
 * fait plus voyager le pseudo et l'avatar. Sans version connue du serveur
 * (première synchronisation, après `reset()`), la valeur entière part comme
 * avant.
 */
@Injectable({ providedIn: 'root' })
export class RemoteUserDataRepository implements UserDataRepository {
  readonly kind = 'remote' as const;

  private readonly api = inject(ApiClientService);
  private readonly local = inject(LocalUserDataRepository);

  private readonly _state = signal<SyncState>('idle');
  private readonly _pending = signal<readonly UserDataKey[]>([]);
  private readonly _lastSyncedAt = signal<Date | null>(null);

  readonly state = this._state.asReadonly();
  readonly pending = this._pending.asReadonly();
  readonly lastSyncedAt = this._lastSyncedAt.asReadonly();

  private readonly pendingKeys = new Set<UserDataKey>();
  /**
   * Dernière valeur de chaque champ que le serveur détient, telle que cet
   * appareil l'a vue (reçue au `pull()`, renvoyée par un rejet, ou confirmée
   * par un envoi appliqué). Base de calcul des écritures partielles ; un champ
   * absent d'ici repart en valeur entière.
   */
  private readonly acked = new Map<UserDataKey, unknown>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;

  /** Prévenu quand des champs ont changé **hors** de cet appareil (hydratation). */
  private externalChangeHandler: ((keys: readonly UserDataKey[]) => void) | null = null;

  setExternalChangeHandler(handler: (keys: readonly UserDataKey[]) => void): void {
    this.externalChangeHandler = handler;
  }

  read<T>(key: UserDataKey): T | undefined {
    return this.local.read<T>(key);
  }

  write(key: UserDataKey, value: unknown): void {
    this.local.write(key, value);
    this.pendingKeys.add(key);
    this._pending.set([...this.pendingKeys]);
    this._state.set('pending');
    this.scheduleFlush();
  }

  /**
   * Réconcilie la configuration locale avec celle du compte. Renvoie les
   * champs effectivement modifiés localement (contenu réellement différent —
   * pas seulement un horodatage plus récent), afin que l'appelant ne fasse
   * recharger leurs signaux aux services que quand c'est utile.
   */
  async pull(): Promise<readonly UserDataKey[]> {
    this._state.set('syncing');
    const result = await this.api.getJson<SettingsResponse>('/settings', { retries: 0 });
    if (!result.ok) {
      // Un 401 est déjà traité globalement (retour en mode invité, voir
      // AuthService) ; tout autre échec laisse simplement l'appareil sur sa
      // copie locale, qui reste parfaitement utilisable.
      this._state.set(this.pendingKeys.size > 0 ? 'pending' : 'error');
      return [];
    }

    const remoteData = result.data.data ?? {};
    const remoteUpdatedAt = result.data.updatedAtByKey ?? {};
    const changed: UserDataKey[] = [];

    for (const key of USER_DATA_KEY_LIST) {
      const remoteIso = remoteUpdatedAt[key];
      const remoteDate = remoteIso ? new Date(remoteIso) : null;
      const localDate = this.local.updatedAt(key);
      const hasRemote =
        key in remoteData && remoteDate !== null && !Number.isNaN(remoteDate.getTime());

      if (!hasRemote) {
        // Champ jamais envoyé au compte : le pousser s'il existe localement.
        this.acked.delete(key);
        if (this.local.read(key) !== undefined) this.pendingKeys.add(key);
        continue;
      }
      if (localDate && localDate.getTime() > remoteDate.getTime()) {
        // La version du compte est connue même si la locale l'emporte : c'est
        // par rapport à elle que l'envoi qui suit sera réduit au strict écart.
        this.acked.set(key, remoteData[key]);
        this.pendingKeys.add(key);
        continue;
      }
      if (this.applyRemote(key, remoteData[key], remoteDate)) changed.push(key);
    }

    this._pending.set([...this.pendingKeys]);
    this._lastSyncedAt.set(new Date());
    if (changed.length > 0) this.externalChangeHandler?.(changed);

    if (this.pendingKeys.size > 0) await this.flush();
    else this._state.set('idle');
    return changed;
  }

  /** Envoie immédiatement les champs en attente (annule l'attente en cours). */
  async flush(): Promise<void> {
    this.cancelScheduledFlush();
    // Sérialise les envois : deux `PATCH` concurrents sur les mêmes clés
    // feraient perdre à l'un l'arbitrage de l'autre pour rien.
    const previous = this.inFlight ?? Promise.resolve();
    this.inFlight = previous.then(() => this.sendPending());
    await this.inFlight;
  }

  /** Vide l'état de synchronisation (déconnexion) sans toucher aux données locales. */
  reset(): void {
    this.cancelScheduledFlush();
    this.pendingKeys.clear();
    this.acked.clear();
    this._pending.set([]);
    this._state.set('idle');
    this._lastSyncedAt.set(null);
  }

  private async sendPending(): Promise<void> {
    if (this.pendingKeys.size === 0) {
      this._state.set('idle');
      return;
    }

    const keys = [...this.pendingKeys];
    const entries: PatchEntry[] = [];
    /** Valeur locale entière derrière chaque entrée envoyée — future `acked` si appliquée. */
    const sentValues = new Map<UserDataKey, unknown>();
    for (const key of keys) {
      const value = this.local.read(key);
      // Un champ effacé entre la mise en attente et l'envoi n'a rien à dire au
      // serveur : le format n'a pas de « supprimer », seulement des valeurs.
      if (value === undefined) continue;
      const updatedAt = (this.local.updatedAt(key) ?? new Date()).toISOString();
      if (isMergeableUserDataKey(key) && this.acked.has(key)) {
        const plan = buildUserDataPatch(key, this.acked.get(key), value);
        // Identique à la version du compte : rien à envoyer, le champ sort de
        // l'attente sans requête (une écriture locale qui n'a rien changé).
        if (plan.kind === 'none') {
          this.pendingKeys.delete(key);
          continue;
        }
        if (plan.kind === 'patch') {
          entries.push({ key, patch: plan.patch, updatedAt });
          sentValues.set(key, value);
          continue;
        }
      }
      entries.push({ key, value, updatedAt });
      sentValues.set(key, value);
    }
    this._pending.set([...this.pendingKeys]);

    if (entries.length === 0) {
      this.pendingKeys.clear();
      this._pending.set([]);
      this._state.set('idle');
      return;
    }

    this._state.set('syncing');
    const result = await this.api.requestJson<PatchResponse>('/settings', {
      method: 'PATCH',
      body: { entries },
    });

    if (!result.ok) {
      // Rien n'est perdu : les champs restent en attente et repartiront à la
      // prochaine écriture, au prochain `pull()` ou à la fermeture de l'onglet.
      this._state.set('error');
      return;
    }

    for (const key of entries.map((entry) => entry.key)) this.pendingKeys.delete(key);
    this._pending.set([...this.pendingKeys]);

    // Le serveur détient désormais ce qu'on lui a envoyé — ou, pour une
    // écriture partielle, la valeur fusionnée qu'il renvoie.
    for (const entry of result.data?.applied ?? []) {
      this.acked.set(
        entry.key,
        entry.value !== undefined ? entry.value : sentValues.get(entry.key),
      );
    }

    const rejected = result.data?.rejected ?? [];
    const changed: UserDataKey[] = [];
    for (const entry of rejected) {
      const remoteDate = new Date(entry.remoteUpdatedAt);
      if (Number.isNaN(remoteDate.getTime())) continue;
      if (this.applyRemote(entry.key, entry.value, remoteDate)) changed.push(entry.key);
    }
    if (changed.length > 0) this.externalChangeHandler?.(changed);

    this._lastSyncedAt.set(new Date());
    this._state.set(this.pendingKeys.size > 0 ? 'pending' : 'idle');
  }

  /**
   * Écrit une valeur venue du compte. Renvoie vrai seulement si le contenu
   * change réellement : sans cette comparaison, chaque démarrage ferait
   * recharger leurs signaux à tous les services pour rien — et, pire, un
   * rechargement de signal en boucle deviendrait possible.
   */
  private applyRemote(key: UserDataKey, value: unknown, updatedAt: Date): boolean {
    if (value === undefined || value === null) return false;
    const before = this.local.serialized(key);
    this.local.writeAt(key, value, updatedAt);
    // Le champ vient d'être aligné sur le compte : plus rien à lui envoyer.
    this.pendingKeys.delete(key);
    this.acked.set(key, value);
    return before !== JSON.stringify(value);
  }

  private scheduleFlush(): void {
    this.cancelScheduledFlush();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, WRITE_DEBOUNCE_MS);
  }

  private cancelScheduledFlush(): void {
    if (this.debounceTimer === null) return;
    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }
}
