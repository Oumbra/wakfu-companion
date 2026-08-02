#!/usr/bin/env node
/**
 * Découpe monsters-list-raw.json (écrit par l'étape 1 du scraping, voir
 * SKILL.md) en lots de N monstres (id + slug) pour l'étape 2 (butin), à
 * coller un par un dans scripts/browser-butin-template.mjs avant de passer
 * le résultat à mcp__playwright__browser_evaluate.
 *
 * Usage :
 *   node split-chunks.mjs <chemin/vers/monsters-list-raw.json> [tailleLot=150]
 *
 * Écrit chunk_0.json, chunk_1.json... dans le même dossier que le fichier
 * source.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [, , inputPath, sizeArg] = process.argv;
if (!inputPath) {
  console.error('Usage: node split-chunks.mjs <monsters-list-raw.json> [tailleLot=150]');
  process.exit(1);
}
const chunkSize = sizeArg ? Number(sizeArg) : 150;

const data = JSON.parse(await readFile(inputPath, 'utf-8'));
const fr = data.fr;
const ids = Object.keys(fr)
  .map(Number)
  .sort((a, b) => a - b);

const dir = path.dirname(inputPath);
let chunkIndex = 0;
for (let i = 0; i < ids.length; i += chunkSize) {
  const slice = ids.slice(i, i + chunkSize).map((id) => ({ id, slug: fr[id].slug }));
  await writeFile(path.join(dir, `chunk_${chunkIndex}.json`), JSON.stringify(slice), 'utf-8');
  console.log(`chunk_${chunkIndex}.json : ${slice.length} monstres`);
  chunkIndex++;
}
console.log(`${chunkIndex} lots écrits (${ids.length} monstres au total).`);
