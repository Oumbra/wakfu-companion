#!/usr/bin/env node
/**
 * Régénère src/app/core/data/build-info.data.ts avec le numéro de version
 * (package.json, voir CLAUDE.md pour la convention d'incrémentation) et
 * l'horodatage du build courant. Exécuté avant chaque build/serve (voir
 * script "generate" combiné, package.json) — affiché dans le pied de page
 * (app-footer), ex. "Build 1.0.0 • 20 juil. 2026, 07:59".
 *
 * L'horodatage est celui de CETTE exécution (npm run generate), pas celui
 * du commit ni un vrai horodatage CI — suffisant pour un repère visuel de
 * fraîcheur du build, pas un identifiant de traçabilité exact.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PACKAGE_JSON_PATH = path.join(projectRoot, 'package.json');
const OUTPUT_PATH = path.join(projectRoot, 'src', 'app', 'core', 'data', 'build-info.data.ts');

const packageJson = JSON.parse(await readFile(PACKAGE_JSON_PATH, 'utf8'));

const header = `// Fichier généré automatiquement par tools/generate-build-info.mjs — ne pas éditer à la main.
// Régénéré avant chaque build/serve (voir "generate" dans package.json).

export const BUILD_VERSION = ${JSON.stringify(packageJson.version)};
export const BUILD_TIMESTAMP = ${Date.now()};
`;

await writeFile(OUTPUT_PATH, header, 'utf8');

console.log(
  `[generate-build-info] version ${packageJson.version}, horodatage ${new Date().toISOString()}.`,
);
