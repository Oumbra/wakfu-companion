#!/usr/bin/env node
/**
 * Construit `referentiel/recipes_wakfu.json` (recettes des objets de métier) à partir du
 * gamedata officiel Ankama (`recipeResults.json` + `recipeIngredients.json`, liés par
 * `recipeId`), puis ajoute/actualise la propriété `hasRecipe` sur chaque entrée de
 * `referentiel/items_wakfu.json` (true si l'`id` de l'objet est un `productedItemId` d'une
 * recette).
 *
 * Un même objet produit peut avoir plusieurs recettes alternatives (73 cas constatés le
 * 2026-08-02, ex. id 21040 : recipeId 4351/5034/9172) : seule la recette au `recipeId` le
 * plus bas (première définie) est conservée — même convention "premier gagne" que
 * `referentiel/dungeons_wakfu.json` (bossMonsterId partagé entre plusieurs donjons).
 *
 * Usage :
 *   node .claude/skills/wakfu-items-sync/scripts/sync-recipes.mjs [--dry-run]
 *   node .claude/skills/wakfu-items-sync/scripts/sync-recipes.mjs --results=<path> --ingredients=<path>
 *
 * `--results`/`--ingredients` permettent de fournir les 2 fichiers gamedata déjà téléchargés
 * localement plutôt que de les récupérer sur `wakfu.cdn.ankama.com` — utile depuis un
 * environnement dont la politique réseau bloque ce domaine (constaté le 2026-08-02 en session
 * Claude Code cloud : `wakfu.cdn.ankama.com` hors allowlist, alors que `jobsItems.json`
 * (sync-items.mjs) et ce même gamedata sont accessibles sans problème depuis un poste normal).
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const RECIPES_PATH = path.join(projectRoot, 'referentiel', 'recipes_wakfu.json');
const ITEMS_PATH = path.join(projectRoot, 'referentiel', 'items_wakfu.json');

const GAMEDATA_CONFIG_URL = 'https://wakfu.cdn.ankama.com/gamedata/config.json';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

async function loadGamedataFile(fileName, overridePath) {
  if (overridePath) {
    console.log(`Lecture locale de ${fileName} (${overridePath})...`);
    return JSON.parse(await readFile(overridePath, 'utf-8'));
  }
  console.log('Récupération de la version gamedata Ankama courante...');
  const { version } = await fetchJson(GAMEDATA_CONFIG_URL);
  console.log(`Version gamedata : ${version}`);
  console.log(`Téléchargement de ${fileName}...`);
  return fetchJson(`https://wakfu.cdn.ankama.com/gamedata/${version}/${fileName}`);
}

function argValue(args, name) {
  const prefix = `--${name}=`;
  const arg = args.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const resultsOverride = argValue(args, 'results');
  const ingredientsOverride = argValue(args, 'ingredients');

  const results = await loadGamedataFile('recipeResults.json', resultsOverride);
  const ingredients = await loadGamedataFile('recipeIngredients.json', ingredientsOverride);
  console.log(`${results.length} recettes (résultats), ${ingredients.length} lignes d'ingrédients.`);

  const ingredientsByRecipe = new Map();
  for (const ing of ingredients) {
    const list = ingredientsByRecipe.get(ing.recipeId);
    if (list) list.push(ing);
    else ingredientsByRecipe.set(ing.recipeId, [ing]);
  }

  const byProductedItem = new Map();
  for (const result of results) {
    const existing = byProductedItem.get(result.productedItemId);
    if (existing && existing.recipeId <= result.recipeId) continue;
    byProductedItem.set(result.productedItemId, result);
  }

  const recipes = [...byProductedItem.values()]
    .map((result) => {
      const recipeIngredients = (ingredientsByRecipe.get(result.recipeId) ?? [])
        .slice()
        .sort((a, b) => a.ingredientOrder - b.ingredientOrder)
        .map((ing) => ({ itemId: ing.itemId, quantity: ing.quantity }));
      return { itemId: result.productedItemId, recipe: recipeIngredients };
    })
    .filter((entry) => entry.recipe.length > 0)
    .sort((a, b) => a.itemId - b.itemId);

  console.log(
    `${recipes.length} objets avec recette retenus (sur ${byProductedItem.size} objets produits distincts).`,
  );

  const items = JSON.parse(await readFile(ITEMS_PATH, 'utf-8'));
  const recipeItemIds = new Set(recipes.map((r) => r.itemId));
  let flippedToTrue = 0;
  let flippedToFalse = 0;
  const updatedItems = items.map((item) => {
    const hasRecipe = typeof item.id === 'number' && recipeItemIds.has(item.id);
    if (hasRecipe && item.hasRecipe !== true) flippedToTrue++;
    if (!hasRecipe && item.hasRecipe === true) flippedToFalse++;
    return { ...item, hasRecipe };
  });

  if (dryRun) {
    console.log(
      `[dry-run] ${recipes.length} recettes seraient écrites dans ${RECIPES_PATH}. Aucune écriture.`,
    );
    console.log(
      `[dry-run] ${ITEMS_PATH} : ${flippedToTrue} objets passeraient à hasRecipe=true, ${flippedToFalse} à hasRecipe=false. Aucune écriture.`,
    );
    return;
  }

  await writeFile(RECIPES_PATH, JSON.stringify(recipes, null, 2) + '\n', 'utf-8');
  console.log(`${recipes.length} recettes écrites dans ${RECIPES_PATH}.`);

  await writeFile(ITEMS_PATH, JSON.stringify(updatedItems, null, 2) + '\n', 'utf-8');
  console.log(
    `${ITEMS_PATH} mis à jour (${flippedToTrue} objets passés à hasRecipe=true, ${flippedToFalse} à hasRecipe=false).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
