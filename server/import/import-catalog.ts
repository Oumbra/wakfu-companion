#!/usr/bin/env -S npx tsx
/**
 * Importe le référentiel Ankama (objets, monstres, donjons, recettes) depuis
 * repository/*.json vers les tables catalogue (voir server/db/schema.ts) —
 * prompt 2.2. Déclenché par .github/workflows/import-catalog.yml quand
 * repository/*.json change (décision actée : PAS de fetch direct de
 * wakfu.cdn.ankama.com depuis ce dépôt, PAS de cron quotidien — ces fichiers
 * sont régénérés à la main via les skills externes wakfu-items-sync /
 * wakfu-monsters-sync, très rarement, voir server/README.md). Exécuté via
 * `npx tsx server/import/import-catalog.ts` (voir script npm "catalog:import").
 *
 * Remplacement complet à chaque exécution (DELETE puis INSERT par lots) —
 * pas de diff incrémental : le volume (~46 000 lignes toutes tables
 * confondues, recettes comprises) rend un remplacement complet largement
 * assez rapide, et évite toute divergence progressive entre le référentiel
 * et la base.
 *
 * Utilise le driver neon-http (comme server/db/client.ts, voir sa
 * documentation) plutôt que neon-serverless : pas de vraies transactions
 * inter-requêtes ici (limite déjà documentée dans server/README.md) — un
 * échec en cours d'exécution peut laisser une table partiellement vidée. Un
 * import est déclenché par un humain à une fréquence très faible (voir
 * ci-dessus) ; le risque est jugé acceptable pour ce lot. À revoir avec
 * neon-serverless si ce script doit un jour tourner sans supervision.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createDb } from '../db/client';
import {
  catalogMeta,
  dungeons,
  itemCategories,
  itemRecipes,
  items,
  monsterFamilies,
  monsters,
  type WakfuDungeonType,
  type WakfuItemCategoryCode,
  type WakfuRarityCode,
} from '../db/schema';
import { buildCompactIndex } from '../catalog/compact-index';

const projectRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const REFERENTIEL_DIR = path.join(projectRoot, 'repository');

interface RawItem {
  id?: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
  rarity: string;
  gfxId: string | number;
  picture_url: string;
  wakassets_available: boolean;
  wakfu_available: boolean;
  hasRecipe?: boolean;
  category?: string;
}

interface RawRecipe {
  itemId: number;
  recipe: { itemId: number; quantity: number }[];
}

interface RawMonsterFamily {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
}

interface RawMonster {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
  gfxId: string;
  family?: number | null;
  picture_url: string;
  wakassets_available: boolean;
  wakfu_available: boolean;
  isBoss: boolean;
  isArchi: boolean;
  isDominant?: boolean;
}

interface RawDungeon {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
  level: number;
  bracket: number;
  type: WakfuDungeonType;
  bossMonsterId?: number | null;
  picture_url: string;
  wakassets_available: boolean;
  has_pre_boss_archi?: boolean;
}

// Seule implémentation de cette logique depuis le lot 3.1 étape 8 (l'équivalent client,
// tools/generate-wakfu-items-data.mjs, a été supprimé avec les tables embarquées — le catalogue
// est désormais entièrement servi par l'API, voir core/api/catalog.service.ts).
const VALID_RARITIES = new Set<WakfuRarityCode>([
  'old',
  'common',
  'rare',
  'mythical',
  'legendary',
  'memory',
  'epic',
  'relic',
]);
const RAW_RARITY_FALLBACK: Record<string, WakfuRarityCode> = { 'Qualité commune': 'old' };
function normalizeRarity(item: RawItem): WakfuRarityCode {
  if (VALID_RARITIES.has(item.rarity as WakfuRarityCode)) return item.rarity as WakfuRarityCode;
  if (RAW_RARITY_FALLBACK[item.rarity]) return RAW_RARITY_FALLBACK[item.rarity];
  console.warn(
    `[import-catalog] rareté "${item.rarity}" invalide pour l'objet id=${item.id ?? '?'} "${item.fr}" -> repli sur "common".`,
  );
  return 'common';
}

// Sous-catégorie fine (`category` dans repository/items.json depuis la refonte du référentiel —
// texte français issu de l'arbre de filtre "Types" de l'encyclopédie officielle, ex. "Casques",
// "Récoltes du Forestier"). Table de référence établie à la main à partir des captures fournies
// par l'utilisateur (equipement_1/2.png, ressources.png, recoltes.png, havre-sac.png,
// cosmetiques.png) : chaque libellé connu y est regroupé sous la catégorie large (filtre par
// icône de l'autocomplétion, voir shared/wakfu-autocomplete) à laquelle il appartient dans cet
// arbre. Les 4 sous-catégories "Créatures" (Reliquâmes, Compagnons, Montures, Familiers), section
// distincte mais capturée à la suite de l'arbre "Equipements" dans equipement_2.png, sont
// rattachées à "equipment" (pas de catégorie large dédiée pour l'instant).
//
// PAS de "Divers" ici (sous-catégorie fourre-tout déjà appliquée par le référentiel à tout objet
// non spécifié dans cet arbre) : un objet dont la sous-catégorie n'a pas de correspondance
// connue dans cette table — que ce soit "Divers" lui-même ou une sous-catégorie future encore
// absente d'ici — retombe sur "craft" s'il a une recette (`hasRecipe`), sinon sur "misc" (voir
// resolveBroadCategory ci-dessous).
const ITEM_SUBCATEGORY_CATALOG: ReadonlyArray<{ fr: string; category: WakfuItemCategoryCode }> = [
  // Equipements (equipement_1.png)
  { fr: 'Porte-bonheurs', category: 'equipment' },
  { fr: 'Amulettes', category: 'equipment' },
  { fr: 'Anneaux', category: 'equipment' },
  { fr: 'Bottes', category: 'equipment' },
  { fr: 'Capes', category: 'equipment' },
  { fr: 'Casques', category: 'equipment' },
  { fr: 'Ceintures', category: 'equipment' },
  { fr: 'Epaulettes', category: 'equipment' },
  { fr: 'Plastrons', category: 'equipment' },
  { fr: 'Armes 1 Main', category: 'equipment' },
  { fr: 'Armes 2 Mains', category: 'equipment' },
  { fr: 'Seconde Main', category: 'equipment' },
  { fr: 'Emblèmes', category: 'equipment' },
  { fr: 'Sacs', category: 'equipment' },
  { fr: 'Panoplies', category: 'equipment' },
  // Créatures (equipement_2.png) — rattachées à "equipment", voir doc ci-dessus.
  { fr: 'Reliquâmes', category: 'equipment' },
  { fr: 'Compagnons', category: 'equipment' },
  { fr: 'Montures', category: 'equipment' },
  { fr: 'Familiers', category: 'equipment' },
  // Havre-Sac (havre-sac.png)
  { fr: 'Décorations de Havre-Enclos', category: 'havenBag' },
  { fr: 'Havres-Gemmes', category: 'havenBag' },
  { fr: 'Havre Monde', category: 'havenBag' },
  { fr: 'Décorations de Havre-Sac', category: 'havenBag' },
  { fr: 'Vitrines & Ateliers', category: 'havenBag' },
  // Récoltes (recoltes.png)
  { fr: 'Récoltes du Paysan', category: 'harvests' },
  { fr: 'Récoltes du Forestier', category: 'harvests' },
  { fr: "Récoltes de l'Herboriste", category: 'harvests' },
  { fr: 'Récoltes du Trappeur', category: 'harvests' },
  { fr: 'Récoltes du Mineur', category: 'harvests' },
  { fr: 'Récoltes du Pêcheur', category: 'harvests' },
  { fr: 'Récoltes diverses', category: 'harvests' },
  // Ressources (ressources.png)
  { fr: "Ressources d'Élevage", category: 'resources' },
  { fr: 'Ressources de monstres', category: 'resources' },
  { fr: 'Sioupêre-Glous', category: 'resources' },
  { fr: 'Fragments de Reliques', category: 'resources' },
  { fr: 'Recettes', category: 'resources' },
  { fr: 'Améliorations', category: 'resources' },
  { fr: 'Ressources diverses', category: 'resources' },
  // Cosmétiques (cosmetiques.png)
  { fr: "Apparences d'équipement", category: 'cosmetics' },
  { fr: 'Costumes', category: 'cosmetics' },
  { fr: 'Artifices', category: 'cosmetics' },
  { fr: 'Transformations', category: 'cosmetics' },
  { fr: 'Attitudes', category: 'cosmetics' },
  { fr: 'Auras & Lumières', category: 'cosmetics' },
  { fr: 'Apparences de Montures', category: 'cosmetics' },
];
const ITEM_SUBCATEGORY_BROAD_CATEGORY: ReadonlyMap<string, WakfuItemCategoryCode> = new Map(
  ITEM_SUBCATEGORY_CATALOG.map((entry) => [entry.fr, entry.category]),
);

/** Catégorie large (`items.category`) déduite de la sous-catégorie fine — voir
 * ITEM_SUBCATEGORY_CATALOG. Toute sous-catégorie absente de cette table (dont "Divers", jamais
 * listée là intentionnellement) retombe sur "craft" (a une recette) ou "misc", comme demandé. */
function resolveBroadCategory(item: RawItem): WakfuItemCategoryCode {
  if (item.category !== undefined) {
    const known = ITEM_SUBCATEGORY_BROAD_CATEGORY.get(item.category);
    if (known) return known;
  }
  return item.hasRecipe === true ? 'craft' : 'misc';
}

/** Assigne un id stable (ordre d'ITEM_SUBCATEGORY_CATALOG, puis toute sous-catégorie
 * supplémentaire réellement rencontrée dans le référentiel — "Divers" aujourd'hui, une nouvelle
 * sous-catégorie de jeu pas encore ajoutée à la table demain) à chaque libellé fin distinct
 * trouvé dans `rawItems`, pour peupler `item_categories` et `items.sub_category_id`. */
function buildSubCategoryIndex(rawItems: readonly RawItem[]): {
  idByLabel: ReadonlyMap<string, number>;
  rows: { id: number; fr: string }[];
} {
  const idByLabel = new Map<string, number>();
  const rows: { id: number; fr: string }[] = [];
  let nextId = 1;
  const assign = (label: string) => {
    if (idByLabel.has(label)) return;
    // "Divers" est un repli attendu (voir doc d'ITEM_SUBCATEGORY_CATALOG), pas une anomalie —
    // seule une sous-catégorie VRAIMENT nouvelle (jeu mis à jour, table pas encore complétée)
    // mérite un avertissement, une seule fois par libellé distinct.
    if (label !== 'Divers' && !ITEM_SUBCATEGORY_BROAD_CATEGORY.has(label)) {
      console.warn(
        `[import-catalog] sous-catégorie "${label}" absente d'ITEM_SUBCATEGORY_CATALOG -> catégorie large repliée sur craft/misc par objet.`,
      );
    }
    idByLabel.set(label, nextId);
    rows.push({ id: nextId, fr: label });
    nextId += 1;
  };
  for (const entry of ITEM_SUBCATEGORY_CATALOG) assign(entry.fr);
  for (const item of rawItems) {
    if (item.category !== undefined) assign(item.category);
  }
  return { idByLabel, rows };
}

/** Insère `rows` par lots de `batchSize` (évite un unique payload HTTP trop volumineux côté
 * driver neon-http pour les tables les plus grosses, ex. item_recipes ~34 300 lignes). Signature
 * volontairement peu typée (`unknown[]`) : les types précis des lignes par table (ItemRow,
 * MonsterRow...) sont déjà vérifiés à leur construction plus bas, ce wrapper générique n'a pas
 * besoin de les reporter. */
/**
 * Écarte les vrais doublons d'objets : même fr/rareté/gfxId (donc visuellement et
 * fonctionnellement le même objet), mais un ankamaId différent — cas apparu en volume (283
 * groupes, 569 lignes en trop) après l'élargissement des sources du skill wakfu-items-sync,
 * confirmé en base (requête `GROUP BY fr, rarity, gfx_id HAVING COUNT(*) > 1`, 2026-08-13). Le
 * champ `en`/`es`/`pt` n'entre PAS dans la clé : vérifié que ces doublons ne diffèrent que par
 * de la casse ou des variantes mineures de traduction sur `pt` (ex. "Amuleto Amargo" vs "Amuleto
 * Inorme" pour la même "Amulette Amer") — les inclure aurait laissé passer 45 des 283 groupes.
 *
 * `ankamaId` reste la clé de `items.pk` n'existant pas côté source, donc pas de fusion possible :
 * un seul des doublons est conservé, les autres sont écartés. Le choix n'est jamais ambigu :
 * vérifié qu'aucun groupe ne voit deux de ses ids référencés à la fois par `recipes.json` (ni
 * comme itemId ni comme ingrédient) — on privilégie donc l'id référencé par une recette quand il
 * y en a un (pour ne jamais casser un lien recette/ingrédient), sinon l'ankamaId le plus bas
 * (déterministe, stable d'un import à l'autre).
 */
function dedupeItemRows(rows: ItemRow[], referencedAnkamaIds: ReadonlySet<number>): ItemRow[] {
  const groups = new Map<string, ItemRow[]>();
  for (const row of rows) {
    const key = `${row.fr}|${row.rarity}|${row.gfxId}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const byAscendingAnkamaId = (a: ItemRow, b: ItemRow) =>
    (a.ankamaId ?? Infinity) - (b.ankamaId ?? Infinity);

  const deduped: ItemRow[] = [];
  let droppedCount = 0;
  for (const group of groups.values()) {
    if (group.length === 1) {
      deduped.push(group[0]);
      continue;
    }
    const referenced = group
      .filter((row) => row.ankamaId !== null && referencedAnkamaIds.has(row.ankamaId))
      .sort(byAscendingAnkamaId);
    const winner = referenced[0] ?? group.slice().sort(byAscendingAnkamaId)[0];
    deduped.push(winner);
    droppedCount += group.length - 1;
  }

  if (droppedCount > 0) {
    console.log(
      `[import-catalog] ${droppedCount} doublons d'objets écartés (même fr/rareté/gfxId, ankamaId différent).`,
    );
  }
  return deduped;
}

async function insertInBatches(
  db: ReturnType<typeof createDb>,
  table: Parameters<typeof db.insert>[0],
  rows: unknown[],
  batchSize = 1000,
): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    await db.insert(table).values(rows.slice(i, i + batchSize) as never);
  }
}

interface ItemRow {
  ankamaId: number | null;
  fr: string;
  en: string;
  es: string;
  pt: string;
  rarity: WakfuRarityCode;
  gfxId: number;
  pictureUrl: string;
  wakassetsAvailable: boolean;
  wakfuAvailable: boolean;
  hasRecipe: boolean;
  category: WakfuItemCategoryCode;
  subCategoryId: number | null;
}

interface MonsterRow {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
  gfxId: string;
  family: number | null;
  pictureUrl: string;
  wakassetsAvailable: boolean;
  wakfuAvailable: boolean;
  isBoss: boolean;
  isArchi: boolean;
  isDominant: boolean;
}

interface MonsterFamilyRow {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL manquant.');

  const [rawItems, rawRecipes, rawMonsters, rawDungeons, rawMonsterFamilies] = await Promise.all([
    readFile(path.join(REFERENTIEL_DIR, 'items.json'), 'utf-8').then(
      (text) => JSON.parse(text) as RawItem[],
    ),
    readFile(path.join(REFERENTIEL_DIR, 'recipes.json'), 'utf-8').then(
      (text) => JSON.parse(text) as RawRecipe[],
    ),
    readFile(path.join(REFERENTIEL_DIR, 'monsters.json'), 'utf-8').then(
      (text) => JSON.parse(text) as RawMonster[],
    ),
    readFile(path.join(REFERENTIEL_DIR, 'dungeons.json'), 'utf-8').then(
      (text) => JSON.parse(text) as RawDungeon[],
    ),
    readFile(path.join(REFERENTIEL_DIR, 'monster-families.json'), 'utf-8').then(
      (text) => JSON.parse(text) as RawMonsterFamily[],
    ),
  ]);

  // Objets : exclusion "old", puis dédoublonnage par (fr, rareté, gfxId) — voir dedupeItemRows.
  // Pas de déduplication par ankamaId seul (voir server/db/schema.ts pour la clé primaire
  // synthétique `items.pk` : ~142 objets sans ankamaId, 2 ids en collision).
  const oldCount = rawItems.filter((item) => normalizeRarity(item) === 'old').length;
  const subCategoryIndex = buildSubCategoryIndex(rawItems);
  const itemCategoryRows = subCategoryIndex.rows;
  const itemRowsWithDuplicates: ItemRow[] = rawItems
    .filter((item) => normalizeRarity(item) !== 'old')
    .map((item) => ({
      ankamaId: typeof item.id === 'number' ? item.id : null,
      fr: item.fr,
      en: item.en,
      es: item.es,
      pt: item.pt,
      rarity: normalizeRarity(item),
      gfxId: Number(item.gfxId),
      pictureUrl: item.picture_url,
      wakassetsAvailable: item.wakassets_available,
      wakfuAvailable: item.wakfu_available,
      hasRecipe: item.hasRecipe === true,
      category: resolveBroadCategory(item),
      subCategoryId:
        item.category !== undefined
          ? (subCategoryIndex.idByLabel.get(item.category) ?? null)
          : null,
    }));

  const recipeRows = rawRecipes.flatMap((entry) =>
    entry.recipe.map((ingredient) => ({
      itemAnkamaId: entry.itemId,
      ingredientAnkamaId: ingredient.itemId,
      quantity: ingredient.quantity,
    })),
  );

  const referencedAnkamaIds = new Set<number>();
  for (const entry of rawRecipes) {
    referencedAnkamaIds.add(entry.itemId);
    for (const ingredient of entry.recipe) referencedAnkamaIds.add(ingredient.itemId);
  }
  const itemRows = dedupeItemRows(itemRowsWithDuplicates, referencedAnkamaIds);

  const monsterRows: MonsterRow[] = rawMonsters.map((monster) => ({
    id: monster.id,
    fr: monster.fr,
    en: monster.en,
    es: monster.es,
    pt: monster.pt,
    gfxId: monster.gfxId,
    family: monster.family ?? null,
    pictureUrl: monster.picture_url,
    wakassetsAvailable: monster.wakassets_available,
    wakfuAvailable: monster.wakfu_available,
    isBoss: monster.isBoss,
    isArchi: monster.isArchi,
    isDominant: monster.isDominant ?? false,
  }));

  const dungeonRows = rawDungeons.map((dungeon) => ({
    id: dungeon.id,
    fr: dungeon.fr,
    en: dungeon.en,
    es: dungeon.es,
    pt: dungeon.pt,
    level: dungeon.level,
    bracket: dungeon.bracket,
    type: dungeon.type,
    bossMonsterId: dungeon.bossMonsterId ?? null,
    pictureUrl: dungeon.picture_url,
    wakassetsAvailable: dungeon.wakassets_available,
    hasPreBossArchi: dungeon.has_pre_boss_archi ?? false,
  }));

  const monsterFamilyRows: MonsterFamilyRow[] = rawMonsterFamilies.map((family) => ({
    id: family.id,
    fr: family.fr,
    en: family.en,
    es: family.es,
    pt: family.pt,
  }));

  const compactIndex = buildCompactIndex(itemRows, monsterRows);
  const compactIndexJson = JSON.stringify(compactIndex);
  const indexHash = createHash('sha256').update(compactIndexJson).digest('hex').slice(0, 16);
  const rawBytes = Buffer.byteLength(compactIndexJson, 'utf-8');

  const db = createDb(databaseUrl);

  console.log(
    `[import-catalog] ${rawItems.length} objets lus (${oldCount} "old" exclus, ${itemRows.length} conservés), ${recipeRows.length} lignes de recette, ${monsterRows.length} monstres, ${dungeonRows.length} donjons, ${monsterFamilyRows.length} familles de monstre, ${itemCategoryRows.length} sous-catégories d'objet.`,
  );
  console.log(
    `[import-catalog] index compact : ${compactIndex.items.length} objets + ${compactIndex.monsters.length} monstres, ${rawBytes} octets bruts (${(rawBytes / 1024).toFixed(1)} Ko).`,
  );

  // items référence itemCategories (sub_category_id) : supprimé avant elle, réinséré après —
  // même contrainte d'ordre que monsters/monsterFamilies ci-dessous.
  await db.delete(itemRecipes);
  await db.delete(items);
  await db.delete(itemCategories);
  await db.delete(monsters);
  await db.delete(dungeons);
  await db.delete(monsterFamilies);

  await insertInBatches(db, itemCategories, itemCategoryRows);
  await insertInBatches(db, items, itemRows);
  await insertInBatches(db, monsterFamilies, monsterFamilyRows);
  await insertInBatches(db, monsters, monsterRows);
  await insertInBatches(db, dungeons, dungeonRows);
  await insertInBatches(db, itemRecipes, recipeRows);

  await db
    .insert(catalogMeta)
    .values({
      id: 'catalog',
      importedAt: new Date(),
      sourceCommit: process.env['GITHUB_SHA'] ?? null,
      itemsCount: itemRows.length,
      monstersCount: monsterRows.length,
      dungeonsCount: dungeonRows.length,
      indexHash,
    })
    .onConflictDoUpdate({
      target: catalogMeta.id,
      set: {
        importedAt: new Date(),
        sourceCommit: process.env['GITHUB_SHA'] ?? null,
        itemsCount: itemRows.length,
        monstersCount: monsterRows.length,
        dungeonsCount: dungeonRows.length,
        indexHash,
      },
    });

  console.log('[import-catalog] import terminé.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
