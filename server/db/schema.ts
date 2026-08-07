import {
  bigint,
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/** Miroir de WakfuRarity (src/app/core/data/wakfu-item-rarity.data.ts) côté serveur — server/
 * reste indépendant de src/ (pas d'import cross-cible), voir server/README.md. `rarity` est
 * stocké en `text` en base (pas d'enum Postgres, pour rester simple à migrer) ; ce type sert
 * uniquement au typage TypeScript des scripts d'import/des endpoints. */
export type WakfuRarityCode =
  'old' | 'common' | 'rare' | 'mythical' | 'legendary' | 'memory' | 'epic' | 'relic';

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

/**
 * Référentiel Ankama (catalogue objets/monstres/donjons), lot 2.2 — voir
 * server/import/import-catalog.ts pour l'import et server/README.md pour
 * l'origine des données (referentiel/*.json, régénérés à la main via les
 * skills externes wakfu-items-sync/wakfu-monsters-sync, PAS un fetch direct
 * de wakfu.cdn.ankama.com depuis ce dépôt).
 *
 * Clé primaire synthétique (`pk`, bigserial) plutôt que l'id Ankama : ~142
 * objets historiques du référentiel n'ont pas d'id Ankama et 2 ids sont en
 * collision (2 objets distincts partageant le même id) — l'id Ankama ne peut
 * donc pas être une clé primaire fiable ici. `ankamaId` reste indexé (non
 * unique) pour les lookups par id. Les objets de rareté "old" sont exclus à
 * l'import (jamais stockés) — voir server/import/import-catalog.ts.
 */
export const items = pgTable(
  'items',
  {
    pk: bigserial('pk', { mode: 'number' }).primaryKey(),
    ankamaId: integer('ankama_id'),
    fr: text('fr').notNull(),
    en: text('en').notNull(),
    es: text('es').notNull(),
    pt: text('pt').notNull(),
    rarity: text('rarity').notNull().$type<WakfuRarityCode>(),
    gfxId: integer('gfx_id').notNull(),
    pictureUrl: text('picture_url').notNull(),
    wakassetsAvailable: boolean('wakassets_available').notNull(),
    wakfuAvailable: boolean('wakfu_available').notNull(),
    hasRecipe: boolean('has_recipe').notNull().default(false),
  },
  (table) => [index('items_ankama_id_idx').on(table.ankamaId)],
);

/**
 * Ingrédients de recette, une ligne par ingrédient (pas de JSON imbriqué,
 * contrairement à `WakfuItemEntry.recipe` côté client) — voir prompt 2.2.
 * `itemAnkamaId`/`ingredientAnkamaId` référencent `items.ankamaId`, pas
 * `items.pk` : un objet sans id Ankama ne peut ni avoir de recette
 * référencée ni être ingrédient (même limite que côté client, voir
 * resolveRecipeIngredientNames).
 */
export const itemRecipes = pgTable(
  'item_recipes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    itemAnkamaId: integer('item_ankama_id').notNull(),
    ingredientAnkamaId: integer('ingredient_ankama_id').notNull(),
    quantity: integer('quantity').notNull(),
  },
  (table) => [index('item_recipes_item_ankama_id_idx').on(table.itemAnkamaId)],
);

/**
 * Monstres — `id` Ankama utilisable comme clé primaire directe ici
 * (contrairement aux objets) : vérifié unique sur les 851 monstres du
 * référentiel actuel. `family` référence un id de
 * referentiel/monster-families_wakfu.json, jamais résolu vers son libellé
 * côté serveur pour l'instant (exploité côté client uniquement comme clé de
 * regroupement brute — voir resolveFightImageInfo dans
 * core/utils/fight-image.util.ts, qui compte les familles distinctes sans
 * jamais afficher leur nom) — pas de table monster_families dans ce lot, à
 * ajouter le jour où un endpoint a besoin du libellé.
 */
export const monsters = pgTable('monsters', {
  id: integer('id').primaryKey(),
  fr: text('fr').notNull(),
  en: text('en').notNull(),
  es: text('es').notNull(),
  pt: text('pt').notNull(),
  gfxId: text('gfx_id').notNull(), // string côté client (CatalogMonsterEntry.gfxId), contrairement aux objets — asymétrie du référentiel source, conservée telle quelle.
  family: integer('family'),
  pictureUrl: text('picture_url').notNull(),
  wakassetsAvailable: boolean('wakassets_available').notNull(),
  wakfuAvailable: boolean('wakfu_available').notNull(),
  isBoss: boolean('is_boss').notNull(),
  isArchi: boolean('is_archi').notNull(),
  isDominant: boolean('is_dominant').notNull().default(false),
});

/** Donjons — `id` Ankama en clé primaire (151 donjons, tous uniques). */
export const dungeons = pgTable(
  'dungeons',
  {
    id: integer('id').primaryKey(),
    fr: text('fr').notNull(),
    en: text('en').notNull(),
    es: text('es').notNull(),
    pt: text('pt').notNull(),
    level: integer('level').notNull(),
    tranche: integer('tranche').notNull(),
    isBreach: boolean('is_breach').notNull(),
    isUltimateBreach: boolean('is_ultimate_breach').notNull(),
    bossMonsterId: integer('boss_monster_id'), // référence monsters.id, nullable (pas de FK stricte : un id de boss peut temporairement ne pas encore être importé selon l'ordre des tables)
    pictureUrl: text('picture_url').notNull(),
    wakassetsAvailable: boolean('wakassets_available').notNull(),
  },
  (table) => [index('dungeons_boss_monster_id_idx').on(table.bossMonsterId)],
);

/**
 * Une seule ligne (id constant `'catalog'`) : métadonnées du dernier import
 * réussi — sert de base à GET /api/v1/catalog/version (prompt 2.2). Pas de
 * vraie "version gamedata" ici (le dépôt n'interroge plus l'API Ankama en
 * direct, voir server/README.md) : `sourceCommit` est le SHA du commit
 * ayant déclenché l'import (referentiel/*.json modifié), `indexHash` une
 * empreinte du contenu de l'index compact servi par /catalog/index.
 */
export const catalogMeta = pgTable('catalog_meta', {
  id: text('id').primaryKey(),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull(),
  sourceCommit: text('source_commit'),
  itemsCount: integer('items_count').notNull(),
  monstersCount: integer('monsters_count').notNull(),
  dungeonsCount: integer('dungeons_count').notNull(),
  indexHash: text('index_hash').notNull(),
});

/**
 * Prix (lot 4, prompt 4.2) — voir docs/plan-migration-serveur.md §8. Source :
 * un skill de scan vidéo de l'hôtel de ventes (prompt 4.1), exécuté en
 * local, totalement indépendant des comptes utilisateurs et des historiques
 * (fights/purchases/trades, lot 8) — AUCUNE des tables ci-dessous ne
 * référence `users`.
 *
 * Architecture de calcul (décision actée avec l'utilisateur, différente du
 * plan initial) : `item_prices_monthly` et `price_trends` ne sont PAS
 * calculées côté serveur (ni par une requête SQL au moment de la lecture, ni
 * par un Cloudflare Cron Trigger — indisponible sur Cloudflare **Pages**,
 * seulement sur les Workers autonomes, voir server/README.md). Un second
 * skill dédié (calcul, pas de vidéo/OCR) lit `GET /api/v1/prices/export`,
 * calcule les agrégats en local, puis les pousse via
 * `POST /api/v1/prices/rollups` — même philosophie que le catalogue
 * (référentiel calculé par un skill externe, le serveur ne fait qu'ingérer).
 * `price_trends` est donc une vraie TABLE ici (écrite par upsert), pas la
 * vue matérialisée SQL envisagée initialement.
 */

/** Une ligne par objet × serveur × jour scanné : le prix affiché le plus bas
 * observé ce jour-là. Écrite uniquement par POST /api/v1/prices/ingest
 * (jeton de service). `itemId` référence `items.ankamaId` (pas `items.pk`,
 * voir plus haut) — pas de FK stricte : un id catalogue peut en théorie
 * disparaître d'un import à l'autre, on ne veut pas qu'un import catalogue
 * fasse échouer une écriture de prix historique. */
export const itemPricesDaily = pgTable(
  'item_prices_daily',
  {
    itemId: integer('item_id').notNull(),
    gameServer: text('game_server')
      .notNull()
      .references(() => gameServers.code),
    capturedOn: date('captured_on').notNull(),
    price: bigint('price', { mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.gameServer, table.capturedOn] }),
    // Sert à la fois GET /prices/{itemId} (borné par itemId+server) et le skill de trends
    // (GET /prices/export, borné par server+date — voir index séparé ci-dessous).
    index('item_prices_daily_item_server_idx').on(table.itemId, table.gameServer),
    index('item_prices_daily_server_date_idx').on(table.gameServer, table.capturedOn),
  ],
);

/** Agrégat mensuel : jusqu'à ~31 lignes de `item_prices_daily` résumées en
 * une seule. Calculée et poussée par le skill de trends (voir doc de
 * section) — PAS par une consolidation SQL serveur. `samplesCount` = nombre
 * de jours réellement scannés ce mois-ci (peut être < jours du mois, voir
 * §8 du plan — à afficher tel quel côté UI, jamais masqué). */
export const itemPricesMonthly = pgTable(
  'item_prices_monthly',
  {
    itemId: integer('item_id').notNull(),
    gameServer: text('game_server')
      .notNull()
      .references(() => gameServers.code),
    month: date('month').notNull(), // 1er jour du mois
    priceMin: bigint('price_min', { mode: 'number' }).notNull(),
    priceMax: bigint('price_max', { mode: 'number' }).notNull(),
    priceAvg: bigint('price_avg', { mode: 'number' }).notNull(),
    samplesCount: integer('samples_count').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.gameServer, table.month] }),
    index('item_prices_monthly_item_server_idx').on(table.itemId, table.gameServer),
  ],
);

/** Tendance de prix (hausse/baisse) par objet × serveur, sur les 30 derniers
 * jours vs les 30 jours précédents — alimente GET /api/v1/prices/trends
 * (classements « plus fortes hausses/baisses », prompt 4.3). Calculée et
 * poussée par le skill de trends, comme `item_prices_monthly` ci-dessus.
 * `changePct` stocké directement (pas recalculé à la lecture) : signé,
 * positif = hausse. */
export const priceTrends = pgTable(
  'price_trends',
  {
    itemId: integer('item_id').notNull(),
    gameServer: text('game_server')
      .notNull()
      .references(() => gameServers.code),
    avgLast30d: bigint('avg_last_30d', { mode: 'number' }).notNull(),
    avgPrev30d: bigint('avg_prev_30d', { mode: 'number' }).notNull(),
    changePct: doublePrecision('change_pct').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.gameServer] }),
    // GET /prices/trends trie par changePct (hausses/baisses) filtré par serveur.
    index('price_trends_server_change_pct_idx').on(table.gameServer, table.changePct),
  ],
);

/** Traçabilité de chaque scan quotidien (un run = un appel à
 * POST /api/v1/prices/ingest) — permet de diagnostiquer un jour sans
 * données ou incomplet plutôt que de deviner (voir §8 du plan).
 * `itemsUnresolved` = noms non résolus par le skill vidéo lui-même (OCR
 * n'ayant matché aucun objet du catalogue, jamais tentés à l'ingestion) ;
 * les items resolus par le skill mais dont l'`itemId` ne correspond plus à
 * aucun objet du catalogue AU MOMENT de l'ingestion (cas plus rare) sont
 * listés dans `notes`, jamais silencieusement ignorés (voir
 * functions/api/v1/prices/ingest.ts). */
export const priceScanRuns = pgTable('price_scan_runs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  gameServer: text('game_server')
    .notNull()
    .references(() => gameServers.code),
  capturedOn: date('captured_on').notNull(),
  itemsCaptured: integer('items_captured').notNull(),
  itemsUnresolved: integer('items_unresolved').notNull().default(0),
  notes: text('notes'),
});
