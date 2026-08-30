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
 * et la base. Exception : `dungeons`, en upsert plutôt qu'en DELETE+INSERT
 * (voir upsertDungeonsInBatches/deleteStaleDungeons plus bas) — seule table
 * catalogue référencée par une FK stricte depuis `fights.dungeon_id`.
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
import { notInArray, sql } from 'drizzle-orm';
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
  // Référence l'`id` d'une entrée de repository/categories.json — un entier, PAS le libellé fr
  // (c'était le cas avant la refonte du référentiel, voir ITEM_SUBCATEGORY_CATALOG plus bas).
  category?: number;
}

interface RawCategory {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
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
  // Ids Ankama des objets droppables sur ce monstre (référentiel curé par le skill externe
  // wakfu-monsters-sync) — toujours un tableau, potentiellement vide (~127 monstres sans loot
  // connu au moment de l'ajout de ce champ). Voir monsters.loot, server/db/schema.ts.
  loot?: number[];
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
  // Curé à la main dans repository/dungeons.json sous 3 formes possibles selon le donjon : `null`
  // (aucun boss, ex. BREACH/ARCADE), un entier (un seul boss, cas le plus courant) ou un tableau
  // (plusieurs boss simultanés, ex. ULTIMATE_BREACH) — voir toIdArray, qui normalise toujours vers
  // un tableau (jamais nu ni `null`) avant insertion en base.
  bossMonsterId?: number | number[] | null;
  // Même convention à 3 formes que bossMonsterId ci-dessus (`null`/entier/tableau) — un donjon
  // classique référence une seule famille, une brèche (BREACH/ULTIMATE_BREACH) plusieurs.
  monsterFamilyId?: number | number[] | null;
  picture_url: string;
  wakassets_available: boolean;
  has_pre_boss_archi?: boolean;
}

/** Normalise `null | number | number[]` (forme de curation manuelle de repository/dungeons.json,
 * voir RawDungeon.bossMonsterId/monsterFamilyId) vers un tableau, toujours — jamais un entier nu
 * ni `null` : c'est cette forme unique qui est insérée en base (dungeons.boss_monster_id/
 * monster_family_id, voir server/db/schema.ts) et donc celle que renvoie l'API /dungeons à tout
 * consommateur, quel que soit le nombre de valeurs (0, 1, ou plusieurs). */
function toIdArray(value: number | number[] | null | undefined): number[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
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
// un id référençant repository/categories.json, ex. 6 = "Casques", 26 = "Récoltes du Forestier" —
// AVANT cette refonte c'était directement le libellé français, voir git blame). Table de
// référence établie à la main à partir des captures fournies par l'utilisateur
// (equipement_1/2.png, ressources.png, recoltes.png, havre-sac.png, cosmetiques.png) : chaque
// sous-catégorie connue y est regroupée sous la catégorie large (filtre par icône de
// l'autocomplétion, voir shared/wakfu-autocomplete) à laquelle elle appartient dans cet arbre.
// Les 4 sous-catégories "Créatures" (Reliquâmes, Compagnons, Montures, Familiers), section
// distincte mais capturée à la suite de l'arbre "Equipements" dans equipement_2.png, sont
// rattachées à "equipment" (pas de catégorie large dédiée pour l'instant).
//
// Indexée par `subCategoryId` (id de repository/categories.json, commenté avec le libellé `fr`
// pour rester lisible) plutôt que par libellé : les deux tables ont été construites dans le même
// ordre (vérifié id par id) et l'id est la clé stable et non ambiguë que categories.json expose
// réellement — un libellé fr aurait pu diverger d'un référentiel à l'autre (casse, accents,
// reformulation) sans que rien ne le détecte.
//
// PAS de "Divers" ici (id 46, sous-catégorie fourre-tout déjà appliquée par le référentiel à tout
// objet non spécifié dans cet arbre) : un id absent de cette table — que ce soit "Divers"
// lui-même ou une sous-catégorie future encore absente d'ici — retombe sur "craft" s'il a une
// recette (`hasRecipe`), sinon sur "misc" (voir resolveBroadCategory ci-dessous).
const ITEM_SUBCATEGORY_CATALOG: ReadonlyArray<{
  subCategoryId: number;
  category: WakfuItemCategoryCode;
}> = [
  // Equipements (equipement_1.png)
  { subCategoryId: 1, category: 'equipment' }, // Porte-bonheurs
  { subCategoryId: 2, category: 'equipment' }, // Amulettes
  { subCategoryId: 3, category: 'equipment' }, // Anneaux
  { subCategoryId: 4, category: 'equipment' }, // Bottes
  { subCategoryId: 5, category: 'equipment' }, // Capes
  { subCategoryId: 6, category: 'equipment' }, // Casques
  { subCategoryId: 7, category: 'equipment' }, // Ceintures
  { subCategoryId: 8, category: 'equipment' }, // Epaulettes
  { subCategoryId: 9, category: 'equipment' }, // Plastrons
  { subCategoryId: 10, category: 'equipment' }, // Armes 1 Main
  { subCategoryId: 11, category: 'equipment' }, // Armes 2 Mains
  { subCategoryId: 12, category: 'equipment' }, // Seconde Main
  { subCategoryId: 13, category: 'equipment' }, // Emblèmes
  { subCategoryId: 14, category: 'equipment' }, // Sacs
  { subCategoryId: 15, category: 'equipment' }, // Panoplies
  // Créatures (equipement_2.png) — rattachées à "equipment", voir doc ci-dessus.
  { subCategoryId: 16, category: 'equipment' }, // Reliquâmes
  { subCategoryId: 17, category: 'equipment' }, // Compagnons
  { subCategoryId: 18, category: 'equipment' }, // Montures
  { subCategoryId: 19, category: 'equipment' }, // Familiers
  // Havre-Sac (havre-sac.png)
  { subCategoryId: 20, category: 'havenBag' }, // Décorations de Havre-Enclos
  { subCategoryId: 21, category: 'havenBag' }, // Havres-Gemmes
  { subCategoryId: 22, category: 'havenBag' }, // Havre Monde
  { subCategoryId: 23, category: 'havenBag' }, // Décorations de Havre-Sac
  { subCategoryId: 24, category: 'havenBag' }, // Vitrines & Ateliers
  // Récoltes (recoltes.png)
  { subCategoryId: 25, category: 'harvests' }, // Récoltes du Paysan
  { subCategoryId: 26, category: 'harvests' }, // Récoltes du Forestier
  { subCategoryId: 27, category: 'harvests' }, // Récoltes de l'Herboriste
  { subCategoryId: 28, category: 'harvests' }, // Récoltes du Trappeur
  { subCategoryId: 29, category: 'harvests' }, // Récoltes du Mineur
  { subCategoryId: 30, category: 'harvests' }, // Récoltes du Pêcheur
  { subCategoryId: 31, category: 'harvests' }, // Récoltes diverses
  // Ressources (ressources.png)
  { subCategoryId: 32, category: 'resources' }, // Ressources d'Élevage
  { subCategoryId: 33, category: 'resources' }, // Ressources de monstres
  { subCategoryId: 34, category: 'resources' }, // Sioupêre-Glous
  { subCategoryId: 35, category: 'resources' }, // Fragments de Reliques
  { subCategoryId: 36, category: 'resources' }, // Recettes
  { subCategoryId: 37, category: 'resources' }, // Améliorations
  { subCategoryId: 38, category: 'resources' }, // Ressources diverses
  // Cosmétiques (cosmetiques.png)
  { subCategoryId: 39, category: 'cosmetics' }, // Apparences d'équipement
  { subCategoryId: 40, category: 'cosmetics' }, // Costumes
  { subCategoryId: 41, category: 'cosmetics' }, // Artifices
  { subCategoryId: 42, category: 'cosmetics' }, // Transformations
  { subCategoryId: 43, category: 'cosmetics' }, // Attitudes
  { subCategoryId: 44, category: 'cosmetics' }, // Auras & Lumières
  { subCategoryId: 45, category: 'cosmetics' }, // Apparences de Montures
];
const ITEM_SUBCATEGORY_BROAD_CATEGORY: ReadonlyMap<number, WakfuItemCategoryCode> = new Map(
  ITEM_SUBCATEGORY_CATALOG.map((entry) => [entry.subCategoryId, entry.category]),
);

/** Catégorie large (`items.category`) déduite de la sous-catégorie fine de l'objet — `item.category`
 * référence directement un id de repository/categories.json, voir ITEM_SUBCATEGORY_CATALOG. Tout
 * id absent de cette table (dont "Divers", jamais listé là intentionnellement) retombe sur
 * "craft" (a une recette) ou "misc", comme demandé. */
function resolveBroadCategory(item: RawItem): WakfuItemCategoryCode {
  if (item.category !== undefined) {
    const known = ITEM_SUBCATEGORY_BROAD_CATEGORY.get(item.category);
    if (known) return known;
  }
  return item.hasRecipe === true ? 'craft' : 'misc';
}

/** Avertit (une fois par id, au démarrage de l'import) si repository/categories.json contient une
 * sous-catégorie inconnue d'ITEM_SUBCATEGORY_CATALOG — hors "Divers" (id 46), repli attendu, voir
 * doc de la table. Signale un référentiel mis à jour (nouvelle sous-catégorie de jeu) avant que
 * resolveBroadCategory ne retombe silencieusement sur craft/misc pour chaque objet concerné. */
function warnUnknownSubCategories(rawCategories: readonly RawCategory[]): void {
  for (const category of rawCategories) {
    if (category.fr === 'Divers' || ITEM_SUBCATEGORY_BROAD_CATEGORY.has(category.id)) continue;
    console.warn(
      `[import-catalog] sous-catégorie "${category.fr}" (id=${category.id}) absente d'ITEM_SUBCATEGORY_CATALOG -> catégorie large repliée sur craft/misc par objet.`,
    );
  }
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

/**
 * `dungeons` est la SEULE table catalogue référencée par une FK stricte
 * (`fights.dungeon_id -> dungeons.id`, ajoutée lot 8 — voir schema.ts) : le
 * schéma `db.delete(table)` puis ré-insertion, utilisé pour toutes les
 * autres tables catalogue (voir main()), y échoue systématiquement dès qu'un
 * seul combat de l'historique référence un donjon existant (23503 "still
 * referenced from table fights", vécu en session le 2026-08-30 dès l'ajout
 * de la colonne monsters.loot, sans rapport direct avec elle — le premier
 * import lancé après que des combats en donjon aient été enregistrés).
 * Upsert (`ON CONFLICT (id) DO UPDATE`) à la place : `dungeons.id` est
 * l'id Ankama, stable d'un import à l'autre, donc les lignes déjà
 * référencées par `fights` ne sont jamais supprimées, seulement mises à
 * jour en place. `sql`excluded.colonne`` (et non une valeur JS captée hors
 * boucle) pour que CHAQUE ligne du batch garde ses propres valeurs au
 * conflit, pas seulement celles de la dernière ligne insérée.
 *
 * Un vrai donjon supprimé du référentiel (cas jamais rencontré en pratique,
 * Ankama n'en retire pas) resterait donc en base indéfiniment avec cette
 * seule fonction — nettoyé séparément par deleteStaleDungeons ci-dessous,
 * qui elle protège explicitement tout donjon encore référencé par un combat.
 */
async function upsertDungeonsInBatches(
  db: ReturnType<typeof createDb>,
  rows: DungeonRow[],
  batchSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    await db
      .insert(dungeons)
      .values(rows.slice(i, i + batchSize))
      .onConflictDoUpdate({
        target: dungeons.id,
        set: {
          fr: sql`excluded.fr`,
          en: sql`excluded.en`,
          es: sql`excluded.es`,
          pt: sql`excluded.pt`,
          level: sql`excluded.level`,
          bracket: sql`excluded.bracket`,
          type: sql`excluded.type`,
          bossMonsterId: sql`excluded.boss_monster_id`,
          monsterFamilyId: sql`excluded.monster_family_id`,
          pictureUrl: sql`excluded.picture_url`,
          wakassetsAvailable: sql`excluded.wakassets_available`,
          hasPreBossArchi: sql`excluded.has_pre_boss_archi`,
        },
      });
  }
}

/** Supprime les donjons présents en base mais absents du référentiel importé (vrai retrait côté
 * Ankama) — voir upsertDungeonsInBatches ci-dessus pour pourquoi ce n'est plus un simple `DELETE
 * FROM dungeons` inconditionnel. Si un tel donjon est encore référencé par un combat de
 * l'historique, cette suppression échoue avec la même erreur 23503 que l'ancien code — attendu et
 * correct dans ce cas précis (un donjon disparu du jeu mais déjà joué ne doit pas être supprimé
 * sous le pied de son historique) plutôt que silencieusement contourné. */
async function deleteStaleDungeons(
  db: ReturnType<typeof createDb>,
  keepIds: number[],
): Promise<void> {
  if (keepIds.length === 0) return; // jamais en pratique (référentiel toujours non vide) — garde-fou contre un DELETE sans condition.
  await db.delete(dungeons).where(notInArray(dungeons.id, keepIds));
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
  loot: number[];
}

interface MonsterFamilyRow {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
}

interface ItemCategoryRow {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
}

interface DungeonRow {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
  level: number;
  bracket: number;
  type: WakfuDungeonType;
  bossMonsterId: number[];
  monsterFamilyId: number[];
  pictureUrl: string;
  wakassetsAvailable: boolean;
  hasPreBossArchi: boolean;
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL manquant.');

  const [rawItems, rawRecipes, rawMonsters, rawDungeons, rawMonsterFamilies, rawCategories] =
    await Promise.all([
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
      readFile(path.join(REFERENTIEL_DIR, 'categories.json'), 'utf-8').then(
        (text) => JSON.parse(text) as RawCategory[],
      ),
    ]);

  // Objets : exclusion "old", puis dédoublonnage par (fr, rareté, gfxId) — voir dedupeItemRows.
  // Pas de déduplication par ankamaId seul (voir server/db/schema.ts pour la clé primaire
  // synthétique `items.pk` : ~142 objets sans ankamaId, 2 ids en collision).
  const oldCount = rawItems.filter((item) => normalizeRarity(item) === 'old').length;
  const itemCategoryRows: ItemCategoryRow[] = rawCategories.map((category) => ({
    id: category.id,
    fr: category.fr,
    en: category.en,
    es: category.es,
    pt: category.pt,
  }));
  warnUnknownSubCategories(rawCategories);
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
      // `item.category` référence déjà directement un id de repository/categories.json (voir
      // RawItem.category plus haut) : plus besoin de résolution par libellé, contrairement à
      // avant la refonte du référentiel.
      subCategoryId: item.category ?? null,
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
    loot: monster.loot ?? [],
  }));

  const dungeonRows: DungeonRow[] = rawDungeons.map((dungeon) => ({
    id: dungeon.id,
    fr: dungeon.fr,
    en: dungeon.en,
    es: dungeon.es,
    pt: dungeon.pt,
    level: dungeon.level,
    bracket: dungeon.bracket,
    type: dungeon.type,
    bossMonsterId: toIdArray(dungeon.bossMonsterId),
    monsterFamilyId: toIdArray(dungeon.monsterFamilyId),
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
  // même contrainte d'ordre que monsters/monsterFamilies ci-dessous. `dungeons` n'est PAS
  // supprimée ici (voir upsertDungeonsInBatches/deleteStaleDungeons) : seule table catalogue
  // référencée par une FK stricte (fights.dungeon_id), un DELETE inconditionnel y échoue dès
  // qu'un combat de l'historique référence un donjon existant.
  await db.delete(itemRecipes);
  await db.delete(items);
  await db.delete(itemCategories);
  await db.delete(monsters);
  await db.delete(monsterFamilies);

  await insertInBatches(db, itemCategories, itemCategoryRows);
  await insertInBatches(db, items, itemRows);
  await insertInBatches(db, monsterFamilies, monsterFamilyRows);
  await insertInBatches(db, monsters, monsterRows);
  await upsertDungeonsInBatches(db, dungeonRows);
  await deleteStaleDungeons(
    db,
    dungeonRows.map((d) => d.id),
  );
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
