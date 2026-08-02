#!/usr/bin/env node
/**
 * Combine les fichiers produits par les étapes 1 (monsters-list-raw.json) et
 * 2 (monsters-drops-chunk*.json) du scraping via Playwright MCP (voir
 * SKILL.md) avec une vérification de disponibilité d'image (Node, non
 * concerné par le blocage anti-bot de wakfu.com — seul wakfu.com l'était),
 * pour écrire referentiel/monsters_wakfu.json et
 * referentiel/monster-families_wakfu.json.
 *
 * Usage (depuis la racine du repo, avec les fichiers intermédiaires
 * présents dans le dossier courant ou passés en argument) :
 *   node .claude/skills/wakfu-monsters-sync/scripts/assemble-monsters.mjs [dossierFichiersIntermediaires]
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const workDir = path.resolve(process.argv[2] ?? projectRoot);

const WAKASSETS_MONSTERS_BASE = 'https://vertylo.github.io/wakassets/monsters';
const WAKASSETS_ILLUSTRATIONS_BASE = 'https://vertylo.github.io/wakassets/monsterIllustrations';
const WAKFU_STATIC_MONSTER_BASE = 'https://static.ankama.com/wakfu/portal/game/monster/42';

async function headOk(url, attempts = 2) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.status === 200) return true;
      if (res.status === 404) return false;
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
  const listRaw = JSON.parse(await readFile(path.join(workDir, 'monsters-list-raw.json'), 'utf-8'));

  const drops = new Map();
  let chunkIndex = 0;
  for (;;) {
    const chunkPath = path.join(workDir, `monsters-drops-chunk${chunkIndex}.json`);
    try {
      const chunk = JSON.parse(await readFile(chunkPath, 'utf-8'));
      for (const rec of chunk) drops.set(rec.id, rec);
      chunkIndex++;
    } catch {
      break;
    }
  }
  console.log(`${chunkIndex} lots de butin chargés, ${drops.size} monstres classifiés.`);

  const { fr, en, es, pt } = listRaw;
  const ids = Object.keys(fr).map(Number).sort((a, b) => a - b);
  console.log(`${ids.length} monstres au total.`);

  const missing = ids.filter((id) => !drops.has(id));
  if (missing.length > 0) {
    console.warn(`ATTENTION : ${missing.length} monstres sans données de butin (lots incomplets ?) : ${missing.slice(0, 10).join(', ')}...`);
  }

  const familyByFr = new Map();
  let nextFamilyId = 1;
  function resolveFamilyId(id) {
    const f = fr[id]?.family;
    if (!f) return null;
    if (!familyByFr.has(f)) {
      familyByFr.set(f, { id: nextFamilyId++, fr: f, en: en[id]?.family ?? null, es: es[id]?.family ?? null, pt: pt[id]?.family ?? null });
    }
    return familyByFr.get(f).id;
  }

  let done = 0;
  const monsters = await mapWithConcurrency(ids, 20, async (id) => {
    const f = fr[id];
    const gfxId = f.gfxId;
    const d = drops.get(id) ?? { isBoss: false, isArchi: false, isDominant: false };
    const familyId = resolveFamilyId(id);

    const [wakassetsAvailable, wakfuAvailable] = gfxId
      ? await Promise.all([
          Promise.all([headOk(`${WAKASSETS_MONSTERS_BASE}/${gfxId}.png`), headOk(`${WAKASSETS_ILLUSTRATIONS_BASE}/${gfxId}.png`)]).then(
            ([a, b]) => a || b,
          ),
          headOk(`${WAKFU_STATIC_MONSTER_BASE}/${gfxId}.png`),
        ])
      : [false, false];

    done++;
    if (done % 100 === 0 || done === ids.length) console.log(`  ${done}/${ids.length}`);

    return {
      id,
      fr: f.name,
      en: en[id]?.name ?? f.name,
      es: es[id]?.name ?? f.name,
      pt: pt[id]?.name ?? f.name,
      family: familyId,
      gfxId,
      picture_url: gfxId ? `${WAKFU_STATIC_MONSTER_BASE}/${gfxId}.png` : null,
      wakassets_available: wakassetsAvailable,
      wakfu_available: wakfuAvailable,
      isBoss: d.isBoss,
      isArchi: d.isArchi,
      isDominant: d.isDominant,
    };
  });

  const families = [...familyByFr.values()].sort((a, b) => a.id - b.id);

  console.log(`${monsters.length} monstres, ${families.length} familles distinctes.`);
  console.log(`  isBoss: ${monsters.filter((m) => m.isBoss).length}`);
  console.log(`  isArchi: ${monsters.filter((m) => m.isArchi).length}`);
  console.log(`  isDominant: ${monsters.filter((m) => m.isDominant).length}`);

  const monstersPath = path.join(projectRoot, 'referentiel', 'monsters_wakfu.json');
  const familiesPath = path.join(projectRoot, 'referentiel', 'monster-families_wakfu.json');
  await writeFile(monstersPath, JSON.stringify(monsters, null, 2) + '\n', 'utf-8');
  await writeFile(familiesPath, JSON.stringify(families, null, 2) + '\n', 'utf-8');
  console.log(`Écrit : ${monstersPath}`);
  console.log(`Écrit : ${familiesPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
