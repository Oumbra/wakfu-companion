import { Injectable, inject, signal } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';
import { LocalUserDataRepository } from './local-user-data.repository';
import { USER_DATA_KEY_LIST, type UserDataKey } from './user-data.keys';
import type { UserDataRepository } from './user-data.repository';

/** Délai d'écriture décalée (prompt 6.1 point 5) : un incrément de compteur de
 * suivi ne doit pas déclencher une requête à lui tout seul. */
const WRITE_DEBOUNCE_MS = 1_500;

export type SyncState = 'idle' | 'pending' | 'syncing' | 'error';

/** Réponse de `PATCH /api/v1/settings` (voir functions/api/v1/settings.ts). */
interface PatchResponse {
  applied: { key: UserDataKey; updatedAt: string }[];
  rejected: { key: UserDataKey; remoteUpdatedAt: string; value: unknown }[];
}

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
        if (this.local.read(key) !== undefined) this.pendingKeys.add(key);
        continue;
      }
      if (localDate && localDate.getTime() > remoteDate.getTime()) {
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
    const entries = keys
      .map((key) => ({
        key,
        value: this.local.read(key),
        updatedAt: (this.local.updatedAt(key) ?? new Date()).toISOString(),
      }))
      // Un champ effacé entre la mise en attente et l'envoi n'a rien à dire au
      // serveur : le format n'a pas de « supprimer », seulement des valeurs.
      .filter((entry) => entry.value !== undefined);

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
