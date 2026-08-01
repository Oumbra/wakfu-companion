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
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REFERENTIEL_PATH = path.join(projectRoot, 'referentiel', 'items_wakfu.json');
const OUTPUT_PATH = path.join(projectRoot, 'src', 'app', 'core', 'data', 'wakfu-items.data.ts');

const VALID_RARITIES = new Set([
  'common',
  'rare',
  'mythical',
  'legendary',
  'souvenir',
  'epic',
  'relic',
]);

/** Doit rester identique à src/app/core/utils/wakfu-name.util.ts. */
function normalizeWakfuName(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[’‘]/g, "'");
}

function buildEntry(item) {
  let rarity = item.rarity;
  if (!VALID_RARITIES.has(rarity)) {
    console.warn(
      `[generate-wakfu-items-data] rareté "${rarity}" invalide pour l'objet id=${item.id ?? '?'} "${item.fr}" -> repli sur "common".`,
    );
    rarity = 'common';
  }
  return {
    fr: item.fr,
    gfxId: Number(item.gfxId),
    en: item.en,
    es: item.es,
    pt: item.pt,
    rarity,
    pictureUrl: item.picture_url,
    wakassetsAvailable: item.wakassets_available,
    wakfuAvailable: item.wakfu_available,
  };
}

function generateFileContent(items) {
  const table = {};
  let duplicateCount = 0;
  for (const item of items) {
    const key = normalizeWakfuName(item.fr);
    if (Object.prototype.hasOwnProperty.call(table, key)) {
      duplicateCount++;
      continue;
    }
    table[key] = buildEntry(item);
  }
  console.log(
    `[generate-wakfu-items-data] ${items.length} objets lus, ${Object.keys(table).length} clés uniques (${duplicateCount} doublons de nom ignorés).`,
  );

  return `/**
 * Table nom d'objet (FR, minuscule, apostrophes typographiques normalisées
 * en apostrophe droite via normalizeWakfuName) -> nom FR affichable (casse
 * d'origine) + gfxId + noms EN/ES/PT + rareté + image officielle, générée
 * depuis referentiel/items_wakfu.json (référentiel complet Ankama,
 * ${items.length} objets). En cas de nom en double dans le référentiel
 * source (avant ou après normalisation des apostrophes), la première entrée
 * rencontrée est conservée. \`wakassetsAvailable\`/\`wakfuAvailable\` indiquent
 * quelles sources d'image sont valides pour cet objet (voir
 * shared/item-icon) : certains objets n'ont pas d'image sur l'un des deux
 * CDN. Le champ \`fr\` sert à l'autocomplétion (shared/wakfu-autocomplete)
 * et au recours d'affichage si la traduction demandée est absente.
 *
 * FICHIER GÉNÉRÉ — ne pas éditer à la main, les modifications seraient
 * écrasées au prochain build/serve. Éditer referentiel/items_wakfu.json puis
 * relancer \`node tools/generate-wakfu-items-data.mjs\` (ou tout simplement
 * npm start / npm run build).
 */
import type { WakfuRarity } from './wakfu-item-rarity.data';
import { normalizeWakfuName } from '../utils/wakfu-name.util';

export interface WakfuItemEntry {
  fr: string;
  gfxId: number;
  en: string;
  es: string;
  pt: string;
  rarity: WakfuRarity;
  pictureUrl: string;
  wakassetsAvailable: boolean;
  wakfuAvailable: boolean;
}

export const WAKFU_ITEMS_FR: Readonly<Record<string, WakfuItemEntry>> = ${JSON.stringify(table)};

/**
 * Index inverse EN/ES/PT -> entrée, construit une seule fois au chargement
 * du module (~${items.length} objets, coût négligeable) : les noms lus dans wakfu.log
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
`;
}

async function main() {
  const referentiel = JSON.parse(await readFile(REFERENTIEL_PATH, 'utf-8'));
  const content = generateFileContent(referentiel);
  await writeFile(OUTPUT_PATH, content, 'utf-8');
  console.log(`[generate-wakfu-items-data] ${OUTPUT_PATH} régénéré.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
