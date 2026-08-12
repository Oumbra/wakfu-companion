import {
  bigint,
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
    bracket: integer('bracket').notNull(),
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
 * observé ce jour-là (`price`) et, si connu, le plus haut (`priceMax`).
 * Écrite uniquement par POST /api/v1/prices/ingest (jeton de service).
 * `itemId` référence `items.ankamaId` (pas `items.pk`, voir plus haut) —
 * pas de FK stricte : un id catalogue peut en théorie disparaître d'un
 * import à l'autre, on ne veut pas qu'un import catalogue fasse échouer une
 * écriture de prix historique.
 *
 * `priceMax` est NOT NULL mais **pas garanti fiable pour toute source** :
 * le skill de scan vidéo (prompt 4.1) ne voit qu'un seul prix par jour (le
 * moins cher affiché) et ne peut pas fournir de vrai maximum — l'API
 * (`ingest.ts`) retombe alors sur `priceMax = price` pour ces lignes-là
 * (on ne veut pas de colonne nullable ni de logique conditionnelle dans les
 * consommateurs en aval). Seul un scan capable d'énumérer plusieurs offres
 * du même jour (scan mémoire HDV plutôt que vidéo) peut fournir un
 * `priceMax` réellement différent de `price` — jusqu'à preuve du contraire,
 * une ligne où `priceMax == price` peut donc signifier soit "un seul prix vu
 * ce jour-là", soit "le max n'a jamais été distinct du min ce jour-là", pas
 * moyen de distinguer les deux sans regarder la source du scan. */
export const itemPricesDaily = pgTable(
  'item_prices_daily',
  {
    itemId: integer('item_id').notNull(),
    gameServer: text('game_server')
      .notNull()
      .references(() => gameServers.code),
    capturedOn: date('captured_on').notNull(),
    price: bigint('price', { mode: 'number' }).notNull(),
    priceMax: bigint('price_max', { mode: 'number' }).notNull(),
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

/**
 * Authentification (lot 5, prompt 5.1) — voir docs/plan-migration-serveur.md §7.
 *
 * Aucun mot de passe n'est géré en propre (pas de `password_hash`, pas de
 * réinitialisation, pas de vérification d'e-mail) : l'identité vient
 * exclusivement d'un fournisseur OAuth (Discord ou Google), qui vérifie
 * l'adresse à notre place. Décision actée §7 du plan, motivée aussi par la
 * limite de 10 ms de CPU par requête du plan gratuit Cloudflare — un hachage
 * de mot de passe correct n'y tient pas.
 *
 * Rappel structurant : la connexion est OPTIONNELLE. Aucune des tables
 * ci-dessus (catalogue, prix) ne référence `users` ; le mode invité continue
 * de fonctionner sans jamais toucher ces tables.
 */

/**
 * Compte utilisateur. `email` est l'e-mail vérifié par le fournisseur OAuth,
 * normalisé en minuscules à l'écriture (voir server/auth/flow.ts) plutôt que
 * stocké en `citext` : évite un `CREATE EXTENSION` supplémentaire pour un
 * gain nul dès lors que la normalisation est faite en un seul endroit.
 * Nullable : un fournisseur peut théoriquement ne pas renvoyer d'e-mail
 * vérifié (compte Discord sans e-mail confirmé) — le compte reste utilisable,
 * il ne participe simplement pas à la fusion sur e-mail (voir flow.ts).
 *
 * `defaultGameServer` était prévue comme repli du lot 7, posée dès le lot 5
 * pour éviter une migration supplémentaire. Le lot 7 a finalement abandonné
 * tout repli global (le serveur vient uniquement du compte roster, voir
 * server/README.md) : **cette colonne n'est lue ni écrite par personne**.
 * Nullable, elle ne coûte rien ; à supprimer si le lot 8 confirme qu'elle ne
 * sert à rien.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email'),
    displayName: text('display_name'),
    defaultGameServer: text('default_game_server'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('users_email_key').on(table.email)],
);

/**
 * Identités OAuth rattachées à un compte. Un même utilisateur peut se
 * connecter par Discord ET par Google : la fusion se fait automatiquement sur
 * e-mail vérifié identique (voir server/auth/flow.ts et §7 du plan — les deux
 * fournisseurs vérifient l'adresse, ce qui rend ce rattachement sûr sans
 * étape manuelle).
 */
export const userIdentities = pgTable(
  'user_identities',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // 'discord' | 'google'
    providerUid: text('provider_uid').notNull(),
    email: text('email'),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerUid] }),
    index('user_identities_user_id_idx').on(table.userId),
  ],
);

/**
 * Sessions serveur (révocation immédiate possible, contrairement à un JWT
 * autoporteur — §7 du plan).
 *
 * ⚠ `id` n'est PAS le jeton envoyé au navigateur : c'est son empreinte
 * SHA-256 (hex). Le jeton opaque (256 bits d'aléa) ne vit que dans le cookie
 * `httpOnly` du client ; une fuite en lecture de cette table ne permet donc
 * pas d'usurper une session. C'est le seul écart avec le schéma du §6 du
 * plan, qui décrivait `id` comme « identifiant opaque » — même colonne, même
 * type, une couche de hachage en plus.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // sha256(jeton du cookie), jamais le jeton lui-même
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

/**
 * Autorisations OAuth en cours (entre `/auth/{provider}/start` et
 * `/auth/{provider}/callback`).
 *
 * Deux raisons de passer par la base plutôt que par un cookie signé :
 * 1. le `code_verifier` PKCE ne doit jamais atteindre le navigateur ;
 * 2. `consumedAt` rend l'autorisation à usage UNIQUE — c'est ce qui fait
 *    rejeter un `code` (donc un `state`) rejoué, exigence du prompt 5.1.
 *
 * `id` est le `state` lui-même (256 bits d'aléa, opaque, non devinable) : il
 * transite en clair dans l'URL de redirection du fournisseur, il n'y a donc
 * rien à protéger d'une fuite en lecture de la table (contrairement au jeton
 * de session ci-dessus, qui, lui, est haché). Les lignes expirées sont
 * purgées à la volée à chaque callback (pas de cron : Cloudflare Pages n'en
 * propose pas, voir server/README.md).
 */
export const oauthAuthorizations = pgTable(
  'oauth_authorizations',
  {
    id: text('id').primaryKey(), // `state`
    provider: text('provider').notNull(),
    codeVerifier: text('code_verifier').notNull(),
    redirectTo: text('redirect_to'), // chemin interne de retour, validé (jamais une URL absolue)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => [index('oauth_authorizations_expires_at_idx').on(table.expiresAt)],
);

/**
 * Limitation de débit des routes `/auth/*` (§7 du plan : « par IP et par
 * compte »). Implémentée en base plutôt qu'en KV/Durable Object : ces routes
 * sont rares (une poignée d'appels par connexion), le coût d'une écriture
 * Postgres y est négligeable, et ça évite d'ajouter un binding Cloudflare
 * supplémentaire au projet Pages.
 *
 * `bucket` = `"{portée}:{clé}"` (ex. `start:ip:1.2.3.4`, `callback:user:<uuid>`),
 * `windowStart` = début de la fenêtre glissante arrondie. Une ligne par
 * fenêtre : les anciennes sont purgées opportunistement (voir
 * server/auth/rate-limit.ts).
 */
export const authRateLimits = pgTable(
  'auth_rate_limits',
  {
    bucket: text('bucket').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.bucket, table.windowStart] })],
);

/**
 * Configuration utilisateur (lot 6 dans le phasage du plan §12) — une ligne
 * par clé, reprenant exactement `EXPORT_KEYS` d'`AppDataExportService` côté
 * client (`profile`, `watchlist`, `roster`, ...), comme prévu au §6.
 *
 * Créée par anticipation au lot 5 (le parcours de migration des données
 * locales du prompt 5.2 n'aurait été qu'une maquette sans stockage), puis
 * exploitée pleinement au lot 6 : `updated_at` porte l'arbitrage « dernier
 * écrivain gagne » **par clé** (voir `server/settings/merge.ts` et
 * `functions/api/v1/settings.ts`). La table elle-même n'a pas eu à changer —
 * aucune migration supplémentaire au lot 6.
 *
 * Les noms de clés acceptés sont une liste blanche fermée
 * (`server/settings/keys.ts`), jamais ce que le client envoie.
 *
 * Le contenu du chat n'y figure pas plus que dans `AppDataExportService` :
 * seuls les *filtres* et *canaux actifs* sont des préférences — les messages
 * eux-mêmes ne quittent jamais la machine du joueur (§7, RGPD : ils
 * appartiennent à des tiers qui n'ont rien demandé).
 */
export const userSettings = pgTable(
  'user_settings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.key] })],
);

/**
 * Historiques personnels (lot 8, prompt 8.1) — combats, achats, échanges.
 *
 * ## `clientKey` : le cœur du lot
 *
 * Le principe d'architecture n°2 (CLAUDE.md) veut que toute (re)connexion au
 * fichier de log le relise **depuis le début** et reconstruise l'intégralité de
 * l'historique. Sans précaution, chaque reconnexion réenverrait tout et
 * créerait des doublons **persistés** — qu'un simple F5 ne réparerait pas.
 *
 * Les identifiants côté client (`nextPurchaseId`, `nextTradeId`, `Fight.id`)
 * sont des compteurs de session, remis à zéro à chaque reconstruction : ils
 * sont inutilisables comme clés. `clientKey` est donc dérivée du **contenu** de
 * l'événement (voir `src/app/core/sync/history-signature.util.ts` et
 * `client-key.util.ts` : `sha256(uid|type|horodatage ms|signature du
 * contenu)`), et `UNIQUE (user_id, client_key)` + `ON CONFLICT DO NOTHING`
 * rendent l'ingestion idempotente : rejouer dix fois le même log n'écrit
 * qu'une ligne.
 *
 * ## Écarts assumés par rapport au §6 du plan
 *
 * 1. **`gameServer` sur les trois tables**, pas seulement `purchases` : le lot
 *    7 a été fait pour « taguer l'historique personnel (combats, achats,
 *    échanges) par serveur de jeu », le §6 ne le portait que sur les achats.
 *    Toujours nullable — aucun serveur résolu n'empêche jamais l'envoi (prompt
 *    8.1 point 4), la colonne reste simplement vide.
 * 2. **`fight_participants` porte un `instanceIndex`** dans sa clé primaire :
 *    la PK `(fight_id, name, side)` du plan entre en collision dès que deux
 *    combattants du même camp partagent un nom, ce qui est courant (voir
 *    `countNameInstances`/`InitiativeSeat` côté client, tout un mécanisme y est
 *    consacré). Sans lui, un combat contre 3 Bouftous perdrait 2 lignes sur 3.
 * 3. **`trade_items` porte un `lineIndex`** et une vraie clé primaire, là où le
 *    §6 laissait la table sans contrainte : c'est ce qui permet de réinsérer
 *    les lignes filles en `ON CONFLICT DO NOTHING` sans jamais les dupliquer
 *    (voir functions/api/v1/history/trades.ts — le driver `neon-http` n'offre
 *    pas de transaction, les filles sont donc écrites en une requête séparée
 *    de leur parent et doivent être idempotentes elles aussi).
 *
 * ## Ce qui n'est jamais envoyé
 *
 * Le contenu du chat (prompt 8.1 point 5) : aucune table ci-dessous ne le
 * référence, et `SYNCED_HISTORY_KINDS` côté client ne l'inclut pas. Les
 * messages appartiennent à des tiers qui n'ont rien demandé (§7 du plan).
 */
export const fights = pgTable(
  'fights',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientKey: text('client_key').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    durationMs: integer('duration_ms'),
    won: boolean('won'),
    turns: integer('turns'),
    totalDamage: bigint('total_damage', { mode: 'number' }),
    xpGained: bigint('xp_gained', { mode: 'number' }),
    kamasGained: bigint('kamas_gained', { mode: 'number' }),
    gameServer: text('game_server').references(() => gameServers.code),
  },
  (table) => [
    uniqueIndex('fights_user_client_key_uq').on(table.userId, table.clientKey),
    // Pagination : « les N combats de cet utilisateur les plus récents ».
    index('fights_user_started_at_idx').on(table.userId, table.startedAt),
  ],
);

/**
 * Une ligne par **instance** de combattant (voir `instanceIndex` ci-dessus), pas
 * par nom.
 *
 * `spells` porte la ventilation des dégâts par sort — `[{ spell, total,
 * byElement: { Feu: 1200, ... } }]`, miroir exact de `SpellBreakdownRow` côté
 * client. En `jsonb` plutôt qu'en table `fight_spells` dédiée, pour une raison
 * qui n'est pas la commodité : c'est la **seule donnée de l'historique que
 * l'utilisateur peut réviser après l'envoi** (réattribution manuelle d'une
 * attaque, voir `reassignSpell`). Un tableau remplacé en bloc à chaque upsert ne
 * peut pas laisser de ligne périmée derrière lui, alors qu'une table de sorts en
 * produirait dès la première réattribution : le sort déplacé s'ajouterait chez
 * sa nouvelle instance sans disparaître de l'ancienne, et le total serait faux.
 * Bonus : aucune requête supplémentaire par lot ingéré.
 *
 * Corollaire, contrairement au reste de l'historique : cette table est écrite en
 * `ON CONFLICT DO UPDATE`, pas `DO NOTHING`. Le combat parent, lui, reste
 * immuable — seul son détail se rafraîchit.
 */
export const fightParticipants = pgTable(
  'fight_participants',
  {
    fightId: bigint('fight_id', { mode: 'number' })
      .notNull()
      .references(() => fights.id, { onDelete: 'cascade' }),
    side: text('side').notNull(), // 'ally' | 'enemy'
    name: text('name').notNull(),
    instanceIndex: integer('instance_index').notNull().default(1),
    className: text('class_name'),
    damage: bigint('damage', { mode: 'number' }).notNull().default(0),
    defeated: boolean('defeated').notNull().default(false),
    spells: jsonb('spells').notNull().default([]),
    /**
     * XP gagnée par ce combattant sur ce combat. Rattachée au participant plutôt
     * qu'à une table `fight_xp` dédiée : le log nomme le bénéficiaire d'un gain
     * d'XP exactement comme le combattant qui a rejoint le combat (vérifié sur
     * les jeux de test — `Caliburnus`, `Sagitta Lucis`...), c'est donc bien un
     * attribut du participant. Zéro table, zéro requête de plus, et
     * `SUM(xp_gained) GROUP BY name` reste immédiat.
     *
     * `0` par défaut, y compris pour les ennemis (à qui la notion ne s'applique
     * pas) : `fights.xp_gained` porte de toute façon le total du combat, qui
     * reste exact même si un bénéficiaire n'a pu être rattaché à aucun
     * participant.
     */
    xpGained: bigint('xp_gained', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.fightId, table.side, table.name, table.instanceIndex] }),
  ],
);

/**
 * Butin d'un combat, une ligne par objet — déjà agrégé par nom côté client
 * (`registerLoot` fusionne les ramassages successifs d'un même objet), d'où la
 * clé primaire `(fight_id, item_name)`.
 *
 * En table relationnelle et non en `jsonb` sur `fights`, à l'inverse des sorts
 * ci-dessus : c'est précisément la donnée qu'on voudra agréger en SQL (« combien
 * de Laine de Bouftou ce mois-ci », « quels donjons rapportent tel ingrédient »),
 * et elle n'est jamais révisée après coup — le butin d'un combat terminé ne
 * bouge plus.
 *
 * `itemId` référence `items.ankamaId` quand le catalogue a pu résoudre le nom,
 * `NULL` sinon ; pas de FK stricte, même raison que pour les prix et les achats.
 */
export const fightLoot = pgTable(
  'fight_loot',
  {
    fightId: bigint('fight_id', { mode: 'number' })
      .notNull()
      .references(() => fights.id, { onDelete: 'cascade' }),
    itemId: integer('item_id'),
    itemName: text('item_name').notNull(),
    quantity: integer('quantity').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.fightId, table.itemName] }),
    // « Tous les combats où cet objet est tombé » — l'agrégation visée ci-dessus.
    index('fight_loot_item_id_idx').on(table.itemId),
  ],
);

/**
 * Achats détectés dans le log (perte de kamas suivie d'un ramassage immédiat,
 * voir `registerPurchase` côté client). `itemId` référence `items.ankamaId`
 * quand l'objet a pu être résolu dans le catalogue, `NULL` sinon — sans FK
 * stricte, pour la même raison que les prix : un import de catalogue ne doit
 * jamais faire échouer l'écriture d'un historique.
 *
 * **Aucun rapport avec le monitoring de prix (lot 4)** : celui-ci vient d'un
 * scan de l'hôtel des ventes, jamais des achats des joueurs (§8 du plan).
 */
export const purchases = pgTable(
  'purchases',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientKey: text('client_key').notNull(),
    itemId: integer('item_id'),
    itemName: text('item_name').notNull(),
    quantity: integer('quantity').notNull(),
    totalCost: bigint('total_cost', { mode: 'number' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    gameServer: text('game_server').references(() => gameServers.code),
  },
  (table) => [
    uniqueIndex('purchases_user_client_key_uq').on(table.userId, table.clientKey),
    index('purchases_user_occurred_at_idx').on(table.userId, table.occurredAt),
  ],
);

/** Échange avec un autre joueur. `peerName` est le personnage EN FACE, `selfName` celui du roster déclaré (voir `registerTrade` côté client). */
export const trades = pgTable(
  'trades',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientKey: text('client_key').notNull(),
    peerName: text('peer_name').notNull(),
    selfName: text('self_name').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    kamasAcquired: bigint('kamas_acquired', { mode: 'number' }).notNull().default(0),
    kamasGiven: bigint('kamas_given', { mode: 'number' }).notNull().default(0),
    gameServer: text('game_server').references(() => gameServers.code),
  },
  (table) => [
    uniqueIndex('trades_user_client_key_uq').on(table.userId, table.clientKey),
    index('trades_user_occurred_at_idx').on(table.userId, table.occurredAt),
  ],
);

/** Objets échangés, une ligne par entrée de chaque côté — `lineIndex` = position dans son côté (voir doc de section). */
export const tradeItems = pgTable(
  'trade_items',
  {
    tradeId: bigint('trade_id', { mode: 'number' })
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(), // 'acquired' | 'given'
    lineIndex: integer('line_index').notNull(),
    itemId: integer('item_id'),
    itemName: text('item_name').notNull(),
    quantity: integer('quantity').notNull(),
  },
  (table) => [primaryKey({ columns: [table.tradeId, table.direction, table.lineIndex] })],
);
