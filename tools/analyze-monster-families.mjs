#!/usr/bin/env node
/**
 * Analyse ponctuelle (PAS un script exécuté par le build/CI) : liste les monstres du catalogue
 * sans famille encyclopédie (`family: null`, ~28/851 au 2026-08-16) qui ne sont PAS le boss d'un
 * donjon référencé — ce sont les seuls qui comptent vraiment pour le palier "famille de monstre"
 * du regroupement "Type" de l'historique des combats (un boss de donjon est déjà groupé par
 * donjon, indépendamment de sa famille, voir resolveFightTypeClassification dans
 * core/utils/fight-image.util.ts) : sans famille, chacun retombe sur un groupe à lui seul (repli
 * par nom normalisé) plutôt que de rejoindre le groupe de ses congénères.
 *
 * Pour chaque monstre orphelin, vérifie s'il existe, ailleurs dans le catalogue, un AUTRE monstre
 * partageant EXACTEMENT le même nom (n'importe quelle langue) et ayant, lui, une famille assignée
 * — un candidat de correction manuelle évident (curation `repository/monsters.json`, voir
 * server/README.md "wakfu-monsters-sync") : réutiliser cette famille plutôt que d'assigner une
 * famille au hasard. Signale aussi, séparément, les orphelins qui partagent leur nom avec un AUTRE
 * orphelin (déjà correctement regroupés aujourd'hui par le repli "nom normalisé", mais un indice
 * que ces deux entrées gagneraient à recevoir la MÊME vraie famille plutôt que de dépendre d'un
 * repli par nom).
 *
 * Usage :
 *   node tools/analyze-monster-families.mjs [baseUrl]
 * `baseUrl` (déf. la preview stable) doit exposer /api/v1/catalog/ et /api/v1/dungeons (voir
 * server/README.md) — AUCUNE donnée de catalogue n'est committée dans ce dépôt (`/repository` est
 * gitignored, régénéré très rarement à la main, voir CLAUDE.md), la seule source de vérité
 * accessible depuis un poste de dev est donc l'API déployée (ou une base Neon locale).
 */
const baseUrl = process.argv[2] ?? 'https://wakfu-companion.pages.dev';

async function getJson(path) {
  const res = await fetch(`${baseUrl}${path}`);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

// Même ordre de tuple que server/catalog/compact-index.ts (v3) / core/api/catalog.service.ts.
function monsterFromTuple([id, fr, en, es, pt, gfxId, family, isBossFlag, isArchiFlag, isDominantFlag]) {
  return {
    id,
    fr,
    en,
    es,
    pt,
    gfxId,
    family: family === -1 ? null : family,
    isBoss: isBossFlag === 1,
    isArchi: isArchiFlag === 1,
    isDominant: isDominantFlag === 1,
  };
}

// Copie de core/utils/wakfu-name.util.ts (normalizeWakfuName) — script Node autonome, pas
// d'import direct d'un module TypeScript compilé pour ce script ponctuel.
function normalize(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[’‘]/g, "'")
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const [{ monsters: monsterTuples }, dungeons] = await Promise.all([
  getJson('/catalog/'),
  getJson('/dungeons'),
]);

const monsters = monsterTuples.map(monsterFromTuple);
const dungeonBossIds = new Set(
  dungeons.map((d) => d.bossMonsterId).filter((id) => id !== null && id !== undefined),
);

const withFamily = monsters.filter((m) => m.family !== null);
const withoutFamily = monsters.filter((m) => m.family === null);
const orphans = withoutFamily.filter((m) => !dungeonBossIds.has(m.id));
const orphanBosses = withoutFamily.filter((m) => dungeonBossIds.has(m.id));

// Index nom normalisé -> monstres AVEC famille (n'importe laquelle des 4 langues).
const familyByName = new Map();
for (const m of withFamily) {
  for (const locale of ['fr', 'en', 'es', 'pt']) {
    const key = normalize(m[locale]);
    if (!familyByName.has(key)) familyByName.set(key, []);
    familyByName.get(key).push(m);
  }
}

console.log(`Total monstres : ${monsters.length}`);
console.log(`Sans famille   : ${withoutFamily.length}`);
console.log(`  dont boss de donjon (déjà groupés par donjon, sans impact) : ${orphanBosses.length}`);
console.log(`  dont "orphelins" pertinents pour le palier "famille"       : ${orphans.length}`);
console.log('');

const candidates = [];
const noCandidates = [];
for (const orphan of orphans) {
  const matches = new Set();
  for (const locale of ['fr', 'en', 'es', 'pt']) {
    const key = normalize(orphan[locale]);
    for (const match of familyByName.get(key) ?? []) matches.add(match);
  }
  if (matches.size > 0) candidates.push({ orphan, matches: [...matches] });
  else noCandidates.push(orphan);
}

console.log(`Orphelins avec un homonyme qui A une famille (candidats de correction) : ${candidates.length}`);
for (const { orphan, matches } of candidates) {
  const suggestion = [...new Set(matches.map((m) => m.family))];
  console.log(
    `  #${orphan.id} "${orphan.fr}" -> homonyme(s) : ${matches
      .map((m) => `#${m.id} "${m.fr}" (famille ${m.family})`)
      .join(', ')}` + (suggestion.length === 1 ? ` => famille suggérée : ${suggestion[0]}` : ' => familles divergentes, à trancher manuellement'),
  );
}

console.log('');
console.log(`Orphelins SANS aucun homonyme avec famille (${noCandidates.length}) :`);
for (const orphan of noCandidates) {
  console.log(`  #${orphan.id} "${orphan.fr}"`);
}

// Orphelins qui partagent leur nom avec un AUTRE orphelin — déjà bien regroupés aujourd'hui (repli
// par nom normalisé, voir resolveFightTypeClassification), mais signalés séparément : la vraie
// correction serait de leur assigner à tous la MÊME famille réelle plutôt que de dépendre du repli.
const orphanByName = new Map();
for (const orphan of orphans) {
  const key = normalize(orphan.fr);
  if (!orphanByName.has(key)) orphanByName.set(key, []);
  orphanByName.get(key).push(orphan);
}
const orphanGroups = [...orphanByName.values()].filter((group) => group.length > 1);
if (orphanGroups.length > 0) {
  console.log('');
  console.log(`Orphelins homonymes ENTRE EUX (déjà fusionnés par repli nom, ${orphanGroups.length} groupe(s)) :`);
  for (const group of orphanGroups) {
    console.log(`  "${group[0].fr}" : ${group.map((m) => `#${m.id}`).join(', ')}`);
  }
}
