import { Injectable, computed, inject } from '@angular/core';
import { LocalUserDataRepository } from './local-user-data.repository';
import { RemoteUserDataRepository } from './remote-user-data.repository';
import { USER_DATA_KEY_LIST, type UserDataKey } from './user-data.keys';
import type { UserDataRepository } from './user-data.repository';

/** Rappel à exécuter quand un champ a été modifié ailleurs qu'ici (autre appareil, autre onglet). */
export type ExternalChangeListener = () => void;

/**
 * Point d'entrée unique des données utilisateur (lot 6, prompt 6.1) : c'est ce
 * service — et lui seul — que consomment `ProfileService`,
 * `StatsStoreService`, `CharacterRosterService` et le panneau de chat.
 *
 * Le §4 du plan exige « jamais de `if (connecté)` dispersés dans les
 * composants » : le mode actif est décidé ici, à un seul endroit, et
 * l'appelant ne voit qu'un `read`/`write` synchrone identique dans les deux
 * cas. La bascule elle-même est déclenchée par `AuthService` — le seul service
 * qui a une raison légitime de connaître l'état de connexion.
 *
 * ## Changements venus d'ailleurs
 *
 * En mode connecté, un autre appareil peut avoir modifié un champ. Les
 * services concernés s'abonnent via `onExternalChange` pour recharger leurs
 * signaux depuis le stockage — sans quoi l'écran continuerait d'afficher
 * l'ancienne valeur jusqu'au prochain rechargement de page.
 */
@Injectable({ providedIn: 'root' })
export class UserDataService {
  private readonly localRepo = inject(LocalUserDataRepository);
  private readonly remoteRepo = inject(RemoteUserDataRepository);

  private active: UserDataRepository = this.localRepo;
  private readonly listeners = new Map<UserDataKey, Set<ExternalChangeListener>>();

  /** État de la réplication vers le compte — `'idle'` en mode invité. */
  readonly syncState = computed(() =>
    this.isRemote() ? this.remoteRepo.state() : ('idle' as const),
  );
  readonly pendingKeys = computed(() => (this.isRemote() ? this.remoteRepo.pending() : []));
  readonly lastSyncedAt = computed(() => (this.isRemote() ? this.remoteRepo.lastSyncedAt() : null));

  constructor() {
    this.remoteRepo.setExternalChangeHandler((keys) => this.notify(keys));

    // Dernière chance d'envoyer ce qui est encore en attente. `pagehide`
    // couvre la fermeture d'onglet et la navigation ; `visibilitychange`
    // couvre le passage en arrière-plan sur mobile, où `pagehide` peut ne
    // jamais arriver. Sans ça, une modification faite moins de 1,5 s avant de
    // fermer l'onglet attendrait le prochain démarrage pour partir.
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => void this.flush());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void this.flush();
      });
    }
  }

  read<T>(key: UserDataKey): T | undefined {
    return this.active.read<T>(key);
  }

  write(key: UserDataKey, value: unknown): void {
    this.active.write(key, value);
  }

  flush(): Promise<void> {
    return this.active.flush();
  }

  isRemote(): boolean {
    return this.active.kind === 'remote';
  }

  /**
   * Bascule en mode connecté et réconcilie avec le compte. Appelé par
   * `AuthService` une fois la session confirmée **et** l'éventuelle décision de
   * migration du lot 5 tranchée : lancer la synchronisation par clé pendant
   * qu'on demande encore à l'utilisateur quelle source garder reviendrait à
   * fusionner en silence, ce que le prompt 5.2 interdit.
   */
  async activateRemote(): Promise<void> {
    this.active = this.remoteRepo;
    await this.remoteRepo.pull();
  }

  /** Retour au mode invité (déconnexion, session expirée). Les données locales restent intactes. */
  deactivateRemote(): void {
    this.remoteRepo.reset();
    this.active = this.localRepo;
  }

  /**
   * Écrit un instantané venu du compte en conservant les horodatages du
   * serveur — utilisé par la migration « récupérer les données du compte »
   * (lot 5). Un horodatage local plus récent que celui du serveur ferait
   * repartir la valeur en sens inverse à la synchronisation suivante.
   */
  applyAccountSnapshot(
    data: Partial<Record<UserDataKey, unknown>>,
    updatedAtByKey?: Partial<Record<UserDataKey, string>>,
  ): void {
    const fallback = new Date();
    for (const key of USER_DATA_KEY_LIST) {
      const value = data[key];
      if (value === undefined) continue;
      const iso = updatedAtByKey?.[key];
      const parsed = iso ? new Date(iso) : null;
      const updatedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback;
      this.localRepo.writeAt(key, value, updatedAt);
    }
  }

  /**
   * Aligne les horodatages locaux sur celui renvoyé par un téléversement
   * complet (`PUT /settings`), pour que la synchronisation suivante ne
   * considère pas la copie locale comme plus récente que ce qu'elle vient
   * elle-même d'envoyer.
   */
  markUploaded(updatedAt: Date): void {
    for (const key of USER_DATA_KEY_LIST) {
      if (this.localRepo.read(key) !== undefined) this.localRepo.touch(key, updatedAt);
    }
  }

  /** Abonnement d'un service à un champ. Renvoie la fonction de désabonnement. */
  onExternalChange(key: UserDataKey, listener: ExternalChangeListener): () => void {
    const set = this.listeners.get(key) ?? new Set<ExternalChangeListener>();
    set.add(listener);
    this.listeners.set(key, set);
    return () => set.delete(listener);
  }

  private notify(keys: readonly UserDataKey[]): void {
    for (const key of keys) {
      for (const listener of this.listeners.get(key) ?? []) listener();
    }
  }
}
