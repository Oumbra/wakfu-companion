import type { UserDataKey } from './user-data.keys';

/**
 * Dépôt des données utilisateur (§4 et §11 du plan de migration, lot 6) —
 * l'interface unique derrière laquelle vivent les deux modes de
 * fonctionnement : invité (`localStorage`, comportement historique) et
 * connecté (compte serveur). Le §4 est explicite : « À encapsuler derrière une
 * interface unique `UserDataRepository`, avec deux implémentations, et
 * **jamais** de `if (connecté)` dispersés dans les composants. »
 *
 * ## Pourquoi la lecture est synchrone
 *
 * Contrainte non négociable, et c'est elle qui dicte toute la forme de cette
 * interface : `ProfileService`, `StatsStoreService` et `CharacterRosterService`
 * lisent leur état dans leur constructeur pour initialiser des signaux, et
 * `StatsStoreService` réécrit la watchlist en plein chemin chaud de parsing
 * (`registerLoot`). Rendre ces accès asynchrones contaminerait tout l'appel —
 * le même raisonnement que pour `findWakfuItemEntry` (§4, point de vigilance
 * n°3 du plan).
 *
 * Conséquence assumée : **le stockage local reste la source de vérité
 * immédiate dans les deux modes**. L'implémentation distante n'y ajoute pas un
 * autre chemin de lecture, elle ajoute une réplication : hydratation depuis le
 * compte au démarrage, puis envoi différé de chaque écriture. Un `read()` ne
 * touche jamais le réseau.
 */
export interface UserDataRepository {
  /** `'local'` = mode invité, `'remote'` = mode connecté (répliqué vers le compte). */
  readonly kind: 'local' | 'remote';

  /** Valeur courante, ou `undefined` si ce champ n'a jamais été écrit. */
  read<T>(key: UserDataKey): T | undefined;

  /** Écrit la valeur localement, et — en mode connecté — la programme pour envoi. */
  write(key: UserDataKey, value: unknown): void;

  /**
   * Envoie sans attendre tout ce qui est en attente (voir l'écriture décalée
   * du prompt 6.1 point 5). No-op en mode invité.
   */
  flush(): Promise<void>;
}
