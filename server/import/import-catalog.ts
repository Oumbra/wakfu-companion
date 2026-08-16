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
  itemRecipes,
  items,
  monsterFamilies,
  monsters,
  type WakfuDungeonType,
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
    `[import-catalog] ${rawItems.length} objets lus (${oldCount} "old" exclus, ${itemRows.length} conservés), ${recipeRows.length} lignes de recette, ${monsterRows.length} monstres, ${dungeonRows.length} donjons, ${monsterFamilyRows.length} familles de monstre.`,
  );
  console.log(
    `[import-catalog] index compact : ${compactIndex.items.length} objets + ${compactIndex.monsters.length} monstres, ${rawBytes} octets bruts (${(rawBytes / 1024).toFixed(1)} Ko).`,
  );

  await db.delete(itemRecipes);
  await db.delete(items);
  await db.delete(monsters);
  await db.delete(dungeons);
  await db.delete(monsterFamilies);

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
