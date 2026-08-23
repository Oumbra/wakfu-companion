/**
 * Clés de configuration utilisateur synchronisables (lot 6, prompt 6.1).
 *
 * Liste blanche **fermée** : le serveur refuse toute clé absente d'ici plutôt
 * que d'accepter n'importe quel nom envoyé par un client. Sans ça, un client
 * modifié pourrait remplir `user_settings` de clés arbitraires — la table
 * n'a aucune autre borne, et son contenu est du `jsonb` opaque.
 *
 * Doit rester **strictement identique** à `USER_DATA_KEYS` côté client
 * (`src/app/core/data-access/user-data.keys.ts`), qui reprend lui-même les
 * champs d'`AppDataExportService.buildExport()` : c'est le même format de
 * charge utile de bout en bout, comme prévu au §11 du plan (« réutilisé tel
 * quel plutôt qu'un format de transport supplémentaire à maintenir »).
 */
export const SYNCED_SETTING_KEYS = [
  'profile',
  'watchlist',
  'watchlistAddMode',
  'damageReassignments',
  'itemReassignments',
  'roster',
  'chatActiveChannels',
  'chatFilters',
  'combatPanelCollapsed',
  'chatPanelCollapsed',
  'dashboardRailCollapsed',
  'dashboardLayout',
] as const;

export type SyncedSettingKey = (typeof SYNCED_SETTING_KEYS)[number];

export function isSyncedSettingKey(key: string): key is SyncedSettingKey {
  return (SYNCED_SETTING_KEYS as readonly string[]).includes(key);
}
