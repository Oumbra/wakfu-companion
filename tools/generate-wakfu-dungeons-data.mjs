#!/usr/bin/env node
/**
 * Régénère src/app/core/data/wakfu-dungeons.data.ts à partir de
 * referentiel/dungeons_wakfu.json. Exécuté avant chaque build/serve (voir
 * scripts "start"/"build" dans package.json,
 * script "generate" combiné) — miroir de tools/generate-wakfu-monsters-data.mjs
 * pour les donjons. Sert notamment à résoudre l'illustration de donjon d'un
 * boss croisé par `bossMonsterId` (voir core/utils/fight-image.util.ts).
 *
 * Dédoublonnage : plusieurs donjons peuvent partager le même bossMonsterId
 * (ex. version classique + brèche d'un même boss) — seule la PREMIÈRE
 * entrée rencontrée dans le référentiel est conservée pour ce boss.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REFERENTIEL_PATH = path.join(projectRoot, 'referentiel', 'dungeons_wakfu.json');
const OUTPUT_PATH = path.join(projectRoot, 'src', 'app', 'core', 'data', 'wakfu-dungeons.data.ts');

function buildEntry(dungeon) {
  return {
    id: dungeon.id,
    fr: dungeon.fr,
    en: dungeon.en,
    es: dungeon.es,
    pt: dungeon.pt,
    level: dungeon.level,
    tranche: dungeon.tranche,
    isBreach: dungeon.isBreach,
    isUltimateBreach: dungeon.isUltimateBreach,
    bossMonsterId: dungeon.bossMonsterId ?? null,
    pictureUrl: dungeon.picture_url,
    wakassetsAvailable: dungeon.wakassets_available,
  };
}

function generateFileContent(dungeons) {
  const entries = dungeons.map(buildEntry);

  let duplicateCount = 0;
  const byBossMonsterId = {};
  for (const entry of entries) {
    if (entry.bossMonsterId === null) continue;
    if (Object.prototype.hasOwnProperty.call(byBossMonsterId, entry.bossMonsterId)) {
      duplicateCount++;
      continue;
    }
    byBossMonsterId[entry.bossMonsterId] = entry;
  }
  console.log(
    `[generate-wakfu-dungeons-data] ${dungeons.length} donjons lus, ${Object.keys(byBossMonsterId).length} bossMonsterId uniques (${duplicateCount} doublons de boss ignorés).`,
  );

  return `/**
 * Table des donjons Wakfu, générée depuis referentiel/dungeons_wakfu.json
 * (référentiel complet Ankama, ${dungeons.length} donjons). \`bossMonsterId\`
 * référence l'\`id\` d'un monstre de referentiel/monsters_wakfu.json
 * (\`null\` pour les donjons/brèches sans boss unique identifié) — utilisé pour
 * résoudre l'illustration de donjon d'un combat de boss (voir
 * core/utils/fight-image.util.ts). En cas de bossMonsterId partagé par
 * plusieurs donjons (ex. version classique + brèche), la première entrée
 * rencontrée dans le référentiel est conservée.
 *
 * FICHIER GÉNÉRÉ — ne pas éditer à la main, les modifications seraient
 * écrasées au prochain build/serve. Éditer referentiel/dungeons_wakfu.json
 * puis relancer \`node tools/generate-wakfu-dungeons-data.mjs\` (ou tout
 * simplement npm start / npm run build).
 */

export interface WakfuDungeonEntry {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
  level: number;
  tranche: number;
  isBreach: boolean;
  isUltimateBreach: boolean;
  bossMonsterId: number | null;
  pictureUrl: string;
  wakassetsAvailable: boolean;
}

export const WAKFU_DUNGEONS: readonly WakfuDungeonEntry[] = ${JSON.stringify(entries)};

const WAKFU_DUNGEONS_BY_BOSS_MONSTER_ID: ReadonlyMap<number, WakfuDungeonEntry> = new Map(
  Object.entries(${JSON.stringify(byBossMonsterId)}).map(([bossMonsterId, entry]) => [
    Number(bossMonsterId),
    entry,
  ]),
);

/** Résout le donjon associé à un boss via son \`id\` monstre (referentiel/monsters_wakfu.json). */
export function findWakfuDungeonByBossMonsterId(bossMonsterId: number): WakfuDungeonEntry | undefined {
  return WAKFU_DUNGEONS_BY_BOSS_MONSTER_ID.get(bossMonsterId);
}
`;
}

async function main() {
  const referentiel = JSON.parse(await readFile(REFERENTIEL_PATH, 'utf-8'));
  const content = generateFileContent(referentiel);
  await writeFile(OUTPUT_PATH, content, 'utf-8');
  console.log(`[generate-wakfu-dungeons-data] ${OUTPUT_PATH} régénéré.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
