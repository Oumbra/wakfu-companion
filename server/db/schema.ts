import { boolean, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * Serveurs de jeu Wakfu (Pandora, Rubilax, Ogrest). Table de référence, très
 * peu de lignes, quasi jamais modifiée — sert de clé étrangère à tout ce qui
 * doit être ventilé par serveur (prix, futurs combats/achats côté compte).
 *
 * `label` est le nom propre du serveur : ni traduit ni localisé (Ankama ne
 * traduit pas les noms de serveurs dans ses 4 locales fr/en/es/pt), donc pas
 * besoin d'une colonne par locale ici — contrairement à l'avertissement du
 * prompt 2.1 sur les « locales attendues par serveur », qui ne s'applique pas
 * au schéma minimal retenu (code/label/is_active, voir docs/plan-migration-serveur.md §6).
 */
export const gameServers = pgTable('game_servers', {
  code: text('code').primaryKey(), // 'pandora' | 'rubilax' | 'ogrest'
  label: text('label').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});
