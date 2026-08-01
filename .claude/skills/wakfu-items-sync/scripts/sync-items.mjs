#!/usr/bin/env node
/**
 * Ajoute au référentiel `referentiel/items_wakfu.json` les objets liés aux
 * métiers (ressources récoltées + résultats de recette) absents de ce
 * référentiel, à partir du gamedata officiel Ankama (`jobsItems.json`).
 *
 * N'écrit JAMAIS les entrées déjà présentes (identifiées par `id`) : certains
 * objets historiques ont une rareté numérique Ankama qui ne correspond plus
 * à leur palier affiché en jeu (ex. costumes "du Sage"/Wabbit Rider marqués
 * rareté 3 côté gamedata mais bien légendaires en jeu) — voir le mapping
 * RARITY_MAP ci-dessous, qui reste un vote majoritaire imparfait. Ne jamais
 * réécrire une entrée existante avec ce mapping sans revue manuelle.
 *
 * Usage :
 *   node .claude/skills/wakfu-items-sync/scripts/sync-items.mjs [--dry-run] [--concurrency=20]
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const REFERENTIEL_PATH = path.join(projectRoot, 'referentiel', 'items_wakfu.json');

const GAMEDATA_CONFIG_URL = 'https://wakfu.cdn.ankama.com/gamedata/config.json';
const WAKASSETS_ITEMS_BASE = 'https://vertylo.github.io/wakassets/items';
const WAKFU_STATIC_ITEM_BASE = 'https://static.ankama.com/wakfu/portal/game/item/42';

/**
 * Vote majoritaire déduit en croisant jobsItems.json avec les ~3800 entrées
 * déjà présentes dans le référentiel partageant le même id (voir historique
 * de session). 0 (objets "de qualité", sans palier réel en jeu) est replié
 * sur "common" faute de palier dédié dans WakfuRarity.
 */
const RARITY_MAP = {
  0: 'common',
  1: 'common',
  2: 'rare',
  3: 'mythical',
  4: 'legendary',
  5: 'relic',
  6: 'souvenir',
  7: 'epic',
};

function pictureUrl(gfxId) {
  return `${WAKFU_STATIC_ITEM_BASE}/${gfxId}.w40h40.png`;
}

function wakassetsUrl(gfxId) {
  return `${WAKASSETS_ITEMS_BASE}/${gfxId}.png`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

async function headOk(url, attempts = 2) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.status === 200) return true;
      if (res.status === 404) return false;
      // Autre statut (429, 5xx...) : on retente une fois avant d'abandonner.
    } catch {
      // Erreur réseau transitoire : on retente une fois avant d'abandonner.
    }
  }
  return false;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const current = next++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const concurrencyArg = args.find((a) => a.startsWith('--concurrency='));
  const concurrency = concurrencyArg ? Number(concurrencyArg.split('=')[1]) : 20;

  console.log('Récupération de la version gamedata Ankama courante...');
  const { version } = await fetchJson(GAMEDATA_CONFIG_URL);
  console.log(`Version gamedata : ${version}`);

  console.log('Téléchargement de jobsItems.json (catalogue objets des métiers)...');
  const jobsItems = await fetchJson(`https://wakfu.cdn.ankama.com/gamedata/${version}/jobsItems.json`);
  console.log(`${jobsItems.length} objets liés aux métiers dans le gamedata.`);

  const referentiel = JSON.parse(await readFile(REFERENTIEL_PATH, 'utf-8'));
  const existingIds = new Set(referentiel.filter((it) => typeof it.id === 'number').map((it) => it.id));

  const missing = jobsItems.filter((j) => !existingIds.has(j.definition.id));
  console.log(`${missing.length} objets absents du référentiel (sur ${jobsItems.length}).`);

  if (missing.length === 0) {
    console.log('Rien à faire, le référentiel est déjà à jour.');
    return;
  }

  console.log(`Vérification de la disponibilité des images sur les 2 CDN (concurrence ${concurrency})...`);
  let done = 0;
  const newEntries = await mapWithConcurrency(missing, concurrency, async (job) => {
    const { id, rarity, graphicParameters } = job.definition;
    const gfxId = String(graphicParameters.gfxId);
    const [wakassetsAvailable, wakfuAvailable] = await Promise.all([
      headOk(wakassetsUrl(gfxId)),
      headOk(pictureUrl(gfxId)),
    ]);
    done++;
    if (done % 200 === 0 || done === missing.length) {
      console.log(`  ${done}/${missing.length}`);
    }
    return {
      id,
      fr: job.title.fr,
      en: job.title.en,
      es: job.title.es,
      pt: job.title.pt,
      rarity: RARITY_MAP[rarity] ?? 'common',
      gfxId,
      picture_url: pictureUrl(gfxId),
      wakassets_available: wakassetsAvailable,
      wakfu_available: wakfuAvailable,
    };
  });

  newEntries.sort((a, b) => a.id - b.id);

  if (dryRun) {
    console.log(`[dry-run] ${newEntries.length} objets seraient ajoutés. Aucune écriture.`);
    console.log(newEntries.slice(0, 10));
    return;
  }

  const merged = [...referentiel, ...newEntries];
  await writeFile(REFERENTIEL_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  console.log(`${newEntries.length} objets ajoutés à ${REFERENTIEL_PATH}.`);
  console.log(`Référentiel : ${referentiel.length} -> ${merged.length} objets.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
