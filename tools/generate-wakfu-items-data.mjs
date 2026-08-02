#!/usr/bin/env node
/**
 * Régénère src/app/core/data/wakfu-items.data.ts à partir de
 * referentiel/items_wakfu.json. Exécuté avant chaque build/serve (voir
 * scripts "start"/"build"/"build:standalone:compile" dans package.json) afin
 * que la table utilisée par l'UI (icônes objets, autocomplétion, rareté)
 * reste synchronisée avec le référentiel sans étape manuelle.
 *
 * Dédoublonnage : à normalisation de nom égale (voir normalizeWakfuName —
 * minuscule + apostrophes typographiques uniformisées), seule la PREMIÈRE
 * entrée rencontrée dans le référentiel est conservée, pour rester cohérent
 * avec le comportement historique du fichier généré à la main qu'il
 * remplace.
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

  const table = {};
  let duplicateCount = 0;
  for (const item of included) {
    const key = normalizeWakfuName(item.fr);
    if (Object.prototype.hasOwnProperty.call(table, key)) {
      duplicateCount++;
      continue;
    }
    table[key] = buildEntry(item, recipesByItemId);
  }
  console.log(
    `[generate-wakfu-items-data] ${items.length} objets lus, ${oldCount} objets "old" exclus, ${Object.keys(table).length} clés uniques (${duplicateCount} doublons de nom ignorés).`,
  );

  return `/**
 * Table nom d'objet (FR, minuscule, apostrophes typographiques normalisées
 * en apostrophe droite via normalizeWakfuName) -> nom FR affichable (casse
 * d'origine) + gfxId + noms EN/ES/PT + rareté + image officielle, générée
 * depuis referentiel/items_wakfu.json (référentiel complet Ankama,
 * ${items.length} objets, dont ${oldCount} exclus car rareté "old"). En cas
 * de nom en double dans le référentiel source (avant ou après normalisation
 * des apostrophes), la première entrée rencontrée est conservée.
 * \`wakassetsAvailable\`/\`wakfuAvailable\` indiquent
 * quelles sources d'image sont valides pour cet objet (voir
 * shared/item-icon) : certains objets n'ont pas d'image sur l'un des deux
 * CDN. Le champ \`fr\` sert à l'autocomplétion (shared/wakfu-autocomplete)
 * et au recours d'affichage si la traduction demandée est absente.
 * \`recipe\` croise referentiel/recipes_wakfu.json par \`id\` (voir
 * .claude/skills/wakfu-items-sync/scripts/sync-recipes.mjs) — vide si
 * \`hasRecipe\` est faux ou si \`id\` est absent du référentiel (142 entrées
 * historiques sans \`id\`, voir SKILL.md).
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
  /** \`id\` Ankama, \`null\` pour les 142 entrées historiques du référentiel qui n'en ont pas
   * (voir SKILL.md) — ces objets ne peuvent alors jamais apparaître comme ingrédient résolu
   * (voir resolveRecipeIngredientNames) ni comme objet à recette. */
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

export const WAKFU_ITEMS_FR: Readonly<Record<string, WakfuItemEntry>> = ${JSON.stringify(table)};

/**
 * Index inverse EN/ES/PT -> entrée, construit une seule fois au chargement
 * du module (~${Object.keys(table).length} objets, coût négligeable) : les noms lus dans wakfu.log
 * sont dans la langue du client Wakfu de l'utilisateur, pas nécessairement
 * le français, contrairement à la clé de WAKFU_ITEMS_FR qui n'indexe que le
 * nom FR. En cas de collision entre 2 objets pour une langue donnée (rare,
 * traductions partagées), la première entrée rencontrée est conservée.
 */
const WAKFU_ITEMS_BY_OTHER_LOCALE: ReadonlyMap<string, WakfuItemEntry> = (() => {
  const map = new Map<string, WakfuItemEntry>();
  for (const entry of Object.values(WAKFU_ITEMS_FR)) {
    for (const localizedName of [entry.en, entry.es, entry.pt]) {
      const key = normalizeWakfuName(localizedName);
      if (!map.has(key)) map.set(key, entry);
    }
  }
  return map;
})();

/** Recherche un objet par nom, quelle que soit sa langue (FR/EN/ES/PT). */
export function findWakfuItemEntry(name: string): WakfuItemEntry | undefined {
  const key = normalizeWakfuName(name);
  return WAKFU_ITEMS_FR[key] ?? WAKFU_ITEMS_BY_OTHER_LOCALE.get(key);
}

/** Index \`id\` Ankama -> entrée, construit une seule fois au chargement du module — sert à
 * résoudre les \`itemId\` d'ingrédients de \`WakfuItemEntry.recipe\` (voir
 * resolveRecipeIngredientNames). Un objet absent de WAKFU_ITEMS_FR (doublon de nom écrasé, voir
 * plus haut) n'y apparaît pas non plus : ses éventuelles recettes/usages en ingrédient ne sont
 * alors pas résolvables, même limite que partout ailleurs dans l'app. */
const WAKFU_ITEMS_BY_ID: ReadonlyMap<number, WakfuItemEntry> = (() => {
  const map = new Map<number, WakfuItemEntry>();
  for (const entry of Object.values(WAKFU_ITEMS_FR)) {
    if (entry.id !== null && !map.has(entry.id)) map.set(entry.id, entry);
  }
  return map;
})();

/** Recherche un objet par \`id\` Ankama. */
export function findWakfuItemEntryById(id: number): WakfuItemEntry | undefined {
  return WAKFU_ITEMS_BY_ID.get(id);
}

/** Résout les ingrédients de la recette d'un objet (\`entry.recipe\`) vers leur nom FR affichable
 * + quantité requise — voir suivi > "suivre les objets de la recette". Un ingrédient dont
 * l'\`itemId\` ne résout à aucune entrée connue (voir WAKFU_ITEMS_BY_ID) est silencieusement omis
 * plutôt que de produire une ligne sans nom. */
export function resolveRecipeIngredientNames(
  entry: WakfuItemEntry,
): { name: string; quantity: number }[] {
  const resolved: { name: string; quantity: number }[] = [];
  for (const ingredient of entry.recipe) {
    const target = WAKFU_ITEMS_BY_ID.get(ingredient.itemId);
    if (target) resolved.push({ name: target.fr, quantity: ingredient.quantity });
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
