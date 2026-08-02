#!/usr/bin/env node
/**
 * Régénère src/app/core/data/wakfu-items.data.ts à partir de
 * referentiel/items_wakfu.json. Exécuté avant chaque build/serve (voir
 * scripts "start"/"build"/"build:standalone:compile" dans package.json) afin
 * que la table utilisée par l'UI (icônes objets, autocomplétion, rareté)
 * reste synchronisée avec le référentiel sans étape manuelle.
 *
 * Pas de dédoublonnage par nom : la table primaire (WAKFU_ITEMS) conserve
 * TOUS les objets du référentiel (hors "old"), y compris les homonymes de
 * rareté différente, indexés par leur \`id\` Ankama (unique) plutôt que par
 * nom (voir normalizeWakfuName pour la normalisation encore utilisée par les
 * index de repli par nom, eux dédupliqués "premier gagne").
 *
 * Exclusion des objets "old" (rareté Ankama 0, "Qualité commune" côté
 * gamedata brut, traduite "Ancien" en jeu) : ce sont des objets historiques
 * retirés du jeu, identifiés manuellement via les captures
 * assets/old-items/*.png (voir session du 2026-08-02) — ils ne sont jamais
 * exclus du référentiel JSON (source de vérité), seulement de cette table
 * de lookup utilisée par l'UI, pour ne jamais faire remonter leur icône/nom
 * dans le tracker/butin à la place d'un objet actuel homonyme.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REFERENTIEL_PATH = path.join(projectRoot, 'referentiel', 'items_wakfu.json');
const RECIPES_PATH = path.join(projectRoot, 'referentiel', 'recipes_wakfu.json');
const OUTPUT_PATH = path.join(projectRoot, 'src', 'app', 'core', 'data', 'wakfu-items.data.ts');

const VALID_RARITIES = new Set([
  'old',
  'common',
  'rare',
  'mythical',
  'legendary',
  'memory',
  'epic',
  'relic',
]);

/** Résidu d'anciens exports référentiel non normalisés (voir wakfu-item-rarity.data.ts). */
const RAW_RARITY_FALLBACK = {
  'Qualité commune': 'old',
};

/** Doit rester identique à src/app/core/utils/wakfu-name.util.ts. */
function normalizeWakfuName(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[’‘]/g, "'");
}

function normalizeRarity(item) {
  if (VALID_RARITIES.has(item.rarity)) return item.rarity;
  if (RAW_RARITY_FALLBACK[item.rarity]) return RAW_RARITY_FALLBACK[item.rarity];
  console.warn(
    `[generate-wakfu-items-data] rareté "${item.rarity}" invalide pour l'objet id=${item.id ?? '?'} "${item.fr}" -> repli sur "common".`,
  );
  return 'common';
}

function buildEntry(item, recipesByItemId) {
  const rarity = normalizeRarity(item);
  const id = typeof item.id === 'number' ? item.id : null;
  return {
    id,
    fr: item.fr,
    gfxId: Number(item.gfxId),
    en: item.en,
    es: item.es,
    pt: item.pt,
    rarity,
    pictureUrl: item.picture_url,
    wakassetsAvailable: item.wakassets_available,
    wakfuAvailable: item.wakfu_available,
    hasRecipe: item.hasRecipe === true,
    recipe: (id !== null && recipesByItemId.get(id)) || [],
  };
}

function generateFileContent(items, recipes) {
  const recipesByItemId = new Map(recipes.map((r) => [r.itemId, r.recipe]));

  const oldCount = items.filter((item) => normalizeRarity(item) === 'old').length;
  const included = items.filter((item) => normalizeRarity(item) !== 'old');

  const list = included.map((item) => buildEntry(item, recipesByItemId));

  let idCollisionCount = 0;
  const seenIds = new Set();
  for (const entry of list) {
    if (entry.id === null) continue;
    if (seenIds.has(entry.id)) idCollisionCount++;
    else seenIds.add(entry.id);
  }
  const withoutId = list.filter((entry) => entry.id === null).length;

  console.log(
    `[generate-wakfu-items-data] ${items.length} objets lus, ${oldCount} objets "old" exclus, ${list.length} objets conservés (${withoutId} sans id, ${idCollisionCount} collisions d'id ignorées).`,
  );

  return `/**
 * Liste de TOUS les objets (hors rareté "old"), générée depuis
 * referentiel/items_wakfu.json (référentiel complet Ankama, ${items.length}
 * objets, dont ${oldCount} exclus car rareté "old") — SANS dédoublonnage par
 * nom : deux objets homonymes de raretés différentes (ex. une même coiffe
 * existant en légendaire et en mythique) apparaissent chacun individuellement,
 * indexés par leur \`id\` Ankama (clé stable et unique, contrairement au nom
 * FR). \`wakassetsAvailable\`/\`wakfuAvailable\` indiquent quelles sources
 * d'image sont valides pour cet objet (voir shared/item-icon) : certains
 * objets n'ont pas d'image sur l'un des deux CDN. Le champ \`fr\` sert à
 * l'autocomplétion (shared/wakfu-autocomplete) et au recours d'affichage si
 * la traduction demandée est absente. \`recipe\` croise
 * referentiel/recipes_wakfu.json par \`id\` (voir
 * .claude/skills/wakfu-items-sync/scripts/sync-recipes.mjs) — vide si
 * \`hasRecipe\` est faux ou si \`id\` est absent du référentiel (${withoutId}
 * entrées historiques sans \`id\`, voir SKILL.md).
 *
 * FICHIER GÉNÉRÉ — ne pas éditer à la main, les modifications seraient
 * écrasées au prochain build/serve. Éditer referentiel/items_wakfu.json puis
 * relancer \`node tools/generate-wakfu-items-data.mjs\` (ou tout simplement
 * npm start / npm run build).
 */
import type { WakfuRarity } from './wakfu-item-rarity.data';
import { normalizeWakfuName } from '../utils/wakfu-name.util';

export interface WakfuRecipeIngredient {
  itemId: number;
  quantity: number;
}

export interface WakfuItemEntry {
  /** \`id\` Ankama, \`null\` pour les ${withoutId} entrées historiques du référentiel qui n'en ont
   * pas (voir SKILL.md) — ces objets ne peuvent alors jamais apparaître comme ingrédient résolu
   * (voir resolveRecipeIngredientNames) ni comme objet à recette, et ne sont accessibles que via
   * un nom (findWakfuItemEntry), jamais via findWakfuItemEntryById. */
  id: number | null;
  fr: string;
  gfxId: number;
  en: string;
  es: string;
  pt: string;
  rarity: WakfuRarity;
  pictureUrl: string;
  wakassetsAvailable: boolean;
  wakfuAvailable: boolean;
  hasRecipe: boolean;
  recipe: readonly WakfuRecipeIngredient[];
}

/** Littéral non typé : une annotation directe (\`: readonly WakfuItemEntry[]\`) sur un littéral de
 * ${list.length} objets fait échouer la compilation (TS2590 "union type too complex to
 * represent") — le cast ci-dessous sur WAKFU_ITEMS l'évite en laissant TS inférer un type élargi
 * avant de le recaster vers l'interface publique. */
const WAKFU_ITEMS_RAW = ${JSON.stringify(list)};

/** Table primaire, sans perte : chaque objet du référentiel (hors "old") est présent
 * individuellement, y compris les homonymes de rareté différente — voir findWakfuItemEntryById
 * pour un accès direct par id, ou searchItems (WakfuSearchService) pour l'autocomplétion qui
 * itère cette liste en entier (contrairement à l'ancienne table dédupliquée par nom). */
export const WAKFU_ITEMS = WAKFU_ITEMS_RAW as readonly WakfuItemEntry[];

/**
 * Index inverse EN/ES/PT -> entrée, construit une seule fois au chargement
 * du module (~${list.length} objets, coût négligeable) : les noms lus dans wakfu.log
 * sont dans la langue du client Wakfu de l'utilisateur, pas nécessairement
 * le français. En cas de collision entre 2 objets pour une langue donnée
 * (nom en double, homonymes...), la première entrée rencontrée est conservée
 * — même limite que findWakfuItemEntry côté FR.
 */
const WAKFU_ITEMS_BY_OTHER_LOCALE: ReadonlyMap<string, WakfuItemEntry> = (() => {
  const map = new Map<string, WakfuItemEntry>();
  for (const entry of WAKFU_ITEMS) {
    for (const localizedName of [entry.en, entry.es, entry.pt]) {
      const key = normalizeWakfuName(localizedName);
      if (!map.has(key)) map.set(key, entry);
    }
  }
  return map;
})();

/** Index nom FR normalisé -> entrée, première entrée rencontrée conservée en cas de doublon de
 * nom (voir WAKFU_ITEMS pour la table complète sans perte) — sert de repli nom -> objet pour les
 * usages qui ne peuvent pas raisonner par id (parsing des logs, qui ne contiennent que des noms). */
const WAKFU_ITEMS_BY_FR_NAME: ReadonlyMap<string, WakfuItemEntry> = (() => {
  const map = new Map<string, WakfuItemEntry>();
  for (const entry of WAKFU_ITEMS) {
    const key = normalizeWakfuName(entry.fr);
    if (!map.has(key)) map.set(key, entry);
  }
  return map;
})();

/** Recherche un objet par nom, quelle que soit sa langue (FR/EN/ES/PT) — en cas d'homonymes,
 * renvoie la première entrée rencontrée dans le référentiel (voir findWakfuItemEntryById pour une
 * résolution non ambiguë par id). */
export function findWakfuItemEntry(name: string): WakfuItemEntry | undefined {
  const key = normalizeWakfuName(name);
  return WAKFU_ITEMS_BY_FR_NAME.get(key) ?? WAKFU_ITEMS_BY_OTHER_LOCALE.get(key);
}

/** Index \`id\` Ankama -> entrée, construit une seule fois au chargement du module — sert à
 * résoudre les \`itemId\` d'ingrédients de \`WakfuItemEntry.recipe\` (voir
 * resolveRecipeIngredientNames) ainsi qu'à la résolution non ambiguë d'une entrée d'autocomplétion
 * (voir WakfuSearchResult.id). Contrairement à l'ancienne table dédupliquée par nom, aucun objet
 * ayant un id n'est perdu ici. */
const WAKFU_ITEMS_BY_ID: ReadonlyMap<number, WakfuItemEntry> = (() => {
  const map = new Map<number, WakfuItemEntry>();
  for (const entry of WAKFU_ITEMS) {
    if (entry.id !== null && !map.has(entry.id)) map.set(entry.id, entry);
  }
  return map;
})();

/** Recherche un objet par \`id\` Ankama. */
export function findWakfuItemEntryById(id: number): WakfuItemEntry | undefined {
  return WAKFU_ITEMS_BY_ID.get(id);
}

export interface WakfuResolvedIngredient {
  name: string;
  quantity: number;
  /** Vrai si cet ingrédient a lui-même une recette connue — pilote l'icône "imbriquer les
   * ingrédients de cet objet" de la modale de suivi de recette. */
  hasRecipe: boolean;
  /** Ingrédients de la recette de CET ingrédient (1 seul niveau, jamais récursif plus profond) —
   * vide si \`hasRecipe\` est faux. Affiché uniquement quand l'utilisateur imbrique la ligne. */
  recipeIngredients: readonly { name: string; quantity: number }[];
}

/** Résout les ingrédients de la recette d'un objet (\`entry.recipe\`) vers leur nom FR affichable
 * + quantité requise — voir suivi > "suivre les objets de la recette". Un ingrédient dont
 * l'\`itemId\` ne résout à aucune entrée connue (voir WAKFU_ITEMS_BY_ID) est silencieusement omis
 * plutôt que de produire une ligne sans nom. Résout aussi, pour chaque ingrédient ayant
 * lui-même une recette, la liste (non récursive) de SES propres ingrédients. */
export function resolveRecipeIngredientNames(entry: WakfuItemEntry): WakfuResolvedIngredient[] {
  const resolved: WakfuResolvedIngredient[] = [];
  for (const ingredient of entry.recipe) {
    const target = WAKFU_ITEMS_BY_ID.get(ingredient.itemId);
    if (!target) continue;
    const recipeIngredients: { name: string; quantity: number }[] = [];
    if (target.hasRecipe) {
      for (const subIngredient of target.recipe) {
        const subTarget = WAKFU_ITEMS_BY_ID.get(subIngredient.itemId);
        if (subTarget) recipeIngredients.push({ name: subTarget.fr, quantity: subIngredient.quantity });
      }
    }
    resolved.push({
      name: target.fr,
      quantity: ingredient.quantity,
      hasRecipe: target.hasRecipe,
      recipeIngredients,
    });
  }
  return resolved;
}
`;
}

async function main() {
  const referentiel = JSON.parse(await readFile(REFERENTIEL_PATH, 'utf-8'));
  const recipes = JSON.parse(await readFile(RECIPES_PATH, 'utf-8'));
  const content = generateFileContent(referentiel, recipes);
  await writeFile(OUTPUT_PATH, content, 'utf-8');
  console.log(`[generate-wakfu-items-data] ${OUTPUT_PATH} régénéré.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
