#!/usr/bin/env node
/**
 * Régénère src/app/core/data/wakfu-monsters.data.ts à partir de
 * referentiel/monsters_wakfu.json. Exécuté avant chaque build/serve (voir
 * scripts "start"/"build" dans package.json,
 * script "generate" combiné) afin que la table utilisée par l'UI (icônes
 * monstre, autocomplétion, classification boss/archimonstre/dominant) reste
 * synchronisée avec le référentiel sans étape manuelle — miroir exact de
 * tools/generate-wakfu-items-data.mjs pour les objets.
 *
 * Dédoublonnage : à normalisation de nom égale (voir normalizeWakfuName —
 * minuscule + apostrophes typographiques uniformisées), seule la PREMIÈRE
 * entrée rencontrée dans le référentiel est conservée, pour rester cohérent
 * avec le comportement historique du fichier généré à la main qu'il
 * remplace (voir historique : la 1ère génération de ce fichier, avant ce
 * script, contenait déjà cette règle en dur).
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REFERENTIEL_PATH = path.join(projectRoot, 'referentiel', 'monsters_wakfu.json');
const OUTPUT_PATH = path.join(projectRoot, 'src', 'app', 'core', 'data', 'wakfu-monsters.data.ts');

/** Doit rester identique à src/app/core/utils/wakfu-name.util.ts. */
function normalizeWakfuName(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[’‘]/g, "'");
}

function buildEntry(monster) {
  return {
    id: monster.id,
    fr: monster.fr,
    gfxId: monster.gfxId,
    en: monster.en,
    es: monster.es,
    pt: monster.pt,
    family: monster.family ?? null,
    pictureUrl: monster.picture_url,
    wakassetsAvailable: monster.wakassets_available,
    wakfuAvailable: monster.wakfu_available,
    isBoss: monster.isBoss,
    isArchi: monster.isArchi,
    isDominant: monster.isDominant ?? false,
  };
}

function generateFileContent(monsters) {
  const table = {};
  let duplicateCount = 0;
  for (const monster of monsters) {
    const key = normalizeWakfuName(monster.fr);
    if (Object.prototype.hasOwnProperty.call(table, key)) {
      duplicateCount++;
      continue;
    }
    table[key] = buildEntry(monster);
  }
  console.log(
    `[generate-wakfu-monsters-data] ${monsters.length} monstres lus, ${Object.keys(table).length} clés uniques (${duplicateCount} doublons de nom ignorés).`,
  );

  return `/**
 * Table nom de monstre (FR, minuscule, apostrophes typographiques
 * normalisées en apostrophe droite via normalizeWakfuName) -> nom FR
 * affichable (casse d'origine) + gfxId + noms EN/ES/PT + famille + image
 * officielle, générée depuis referentiel/monsters_wakfu.json (référentiel
 * complet Ankama, ${monsters.length} monstres). En cas de nom en double dans
 * le référentiel source (avant ou après normalisation des apostrophes), la
 * première entrée rencontrée est conservée. \`wakassetsAvailable\`/
 * \`wakfuAvailable\` indiquent quelles sources d'image sont valides pour ce
 * monstre (voir shared/entity-icon). \`family\` référence un id de
 * referentiel/monster-families_wakfu.json (\`null\` si le monstre n'appartient
 * à aucune famille listée sur l'encyclopédie — état normal pour la plupart
 * des monstres de terrain). \`isBoss\`/\`isArchi\`/\`isDominant\` indiquent si
 * ce monstre drop respectivement un Jeton/une Pierre (boss de donjon), un
 * Reliquâme/Archiemblème (archimonstre), ou un Masque (dominant) sur
 * l'encyclopédie Ankama. Le champ \`fr\` sert à l'autocomplétion
 * (shared/wakfu-autocomplete). \`id\` est l'identifiant Ankama du monstre,
 * utilisé pour croiser \`bossMonsterId\` de referentiel/dungeons_wakfu.json
 * (voir core/data/wakfu-dungeons.data.ts et core/utils/fight-image.util.ts).
 *
 * FICHIER GÉNÉRÉ — ne pas éditer à la main, les modifications seraient
 * écrasées au prochain build/serve. Éditer referentiel/monsters_wakfu.json
 * puis relancer \`node tools/generate-wakfu-monsters-data.mjs\` (ou tout
 * simplement npm start / npm run build).
 */
import { normalizeWakfuName } from '../utils/wakfu-name.util';

export interface WakfuMonsterEntry {
  id: number;
  fr: string;
  gfxId: string;
  en: string;
  es: string;
  pt: string;
  family: number | null;
  pictureUrl: string;
  wakassetsAvailable: boolean;
  wakfuAvailable: boolean;
  isBoss: boolean;
  isArchi: boolean;
  isDominant: boolean;
}

export const WAKFU_MONSTERS_FR: Readonly<Record<string, WakfuMonsterEntry>> = ${JSON.stringify(table)};

/**
 * Index inverse EN/ES/PT -> entrée, construit une seule fois au chargement
 * du module (~${Object.keys(table).length} monstres, coût négligeable) : les noms lus dans wakfu.log
 * sont dans la langue du client Wakfu de l'utilisateur, pas nécessairement
 * le français, contrairement à la clé de WAKFU_MONSTERS_FR qui n'indexe que
 * le nom FR. En cas de collision entre 2 monstres pour une langue donnée
 * (rare, traductions partagées), la première entrée rencontrée est
 * conservée.
 */
const WAKFU_MONSTERS_BY_OTHER_LOCALE: ReadonlyMap<string, WakfuMonsterEntry> = (() => {
  const map = new Map<string, WakfuMonsterEntry>();
  for (const entry of Object.values(WAKFU_MONSTERS_FR)) {
    for (const localizedName of [entry.en, entry.es, entry.pt]) {
      const key = normalizeWakfuName(localizedName);
      if (!map.has(key)) map.set(key, entry);
    }
  }
  return map;
})();

/** Recherche un monstre par nom, quelle que soit sa langue (FR/EN/ES/PT). */
export function findWakfuMonsterEntry(name: string): WakfuMonsterEntry | undefined {
  const key = normalizeWakfuName(name);
  return WAKFU_MONSTERS_FR[key] ?? WAKFU_MONSTERS_BY_OTHER_LOCALE.get(key);
}

/** Vrai si \`name\` correspond à un monstre connu du référentiel, quelle que soit sa langue. */
export function isKnownWakfuMonsterName(name: string): boolean {
  return findWakfuMonsterEntry(name) !== undefined;
}
`;
}

async function main() {
  const referentiel = JSON.parse(await readFile(REFERENTIEL_PATH, 'utf-8'));
  const content = generateFileContent(referentiel);
  await writeFile(OUTPUT_PATH, content, 'utf-8');
  console.log(`[generate-wakfu-monsters-data] ${OUTPUT_PATH} régénéré.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
