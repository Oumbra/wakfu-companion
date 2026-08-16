/**
 * Données utilisateur synchronisables (lot 6, prompt 6.1) : un champ logique →
 * la clé `localStorage` historique qui le porte déjà.
 *
 * Ce fichier n'importe **rien** volontairement. Les clés vivaient jusqu'ici
 * dans les services qui les écrivent (`PROFILE_KEY` dans `profile.service.ts`,
 * `WATCHLIST_KEY` dans `stats-store.service.ts`...) ; les rassembler ici est
 * ce qui permet à ces mêmes services de dépendre du dépôt de données sans
 * créer de cycle d'imports (`profile.service` → `user-data.service` →
 * `profile.service`).
 *
 * La liste doit rester strictement identique à `SYNCED_SETTING_KEYS` côté
 * serveur (`server/settings/keys.ts`), qui la refuse en liste blanche.
 */
export const USER_DATA_KEYS = {
  profile: 'wakfu-profile',
  watchlist: 'wakfu-watchlist',
  watchlistAddMode: 'wakfu-watchlist-add-mode',
  damageReassignments: 'wakfu-damage-reassignments',
  itemReassignments: 'wakfu-item-reassignments',
  roster: 'wakfu-character-roster',
  chatActiveChannels: 'wakfu-active-chat-channels',
  chatFilters: 'wakfu-chat-filters',
} as const;

export type UserDataKey = keyof typeof USER_DATA_KEYS;

export const USER_DATA_KEY_LIST = Object.keys(USER_DATA_KEYS) as readonly UserDataKey[];

/**
 * Clé `localStorage` utilisée pour mémoriser, par champ, la date de dernière
 * modification locale. Sans elle, aucun arbitrage « dernier écrivain gagne »
 * n'est possible : on ne saurait pas si la valeur locale est plus récente que
 * celle du compte. Volontairement **hors** de `USER_DATA_KEYS` — c'est une
 * métadonnée de synchronisation propre à cet appareil, elle n'a rien à faire
 * dans le compte ni dans l'export de données.
 */
export const USER_DATA_META_KEY = 'wakfu-user-data-meta';
