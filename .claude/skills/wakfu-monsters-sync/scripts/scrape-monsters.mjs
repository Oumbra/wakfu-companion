#!/usr/bin/env node
/**
 * Reconstruit `referentiel/monsters_wakfu.json` et `referentiel/monster-families_wakfu.json`
 * en scrapant l'encyclopédie officielle (www.wakfu.com, section mmorpg/encyclopedie/monstres),
 * seule source disponible pour les monstres : contrairement aux objets, Ankama
 * ne publie aucun gamedata JSON pour les monstres/butins (403 sur tous les noms de
 * fichiers plausibles - `monsters.json`, `monsterRaces.json`... - confirmé par de la
 * doc communautaire : Ankama refuse volontairement d'exposer ces données).
 *
 * Usage :
 *   node .claude/skills/wakfu-monsters-sync/scripts/scrape-monsters.mjs [--dry-run] [--limit=N] [--concurrency=2] [--checkpoint=path]
 *
 * --limit=N : ne traite que les N premiers monstres de la liste FR (debug/test rapide).
 *
 * wakfu.com bloque (HTTP 403 sur TOUTES les requêtes suivantes, y compris des
 * pages qui venaient de fonctionner) après environ 200 requêtes rapprochées —
 * un vrai rate-limit/WAF, pas une histoire de cookies. D'où : throttle global
 * (délai minimum partagé entre TOUTES les requêtes, pas juste par worker),
 * cooldown + retry exponentiel dès qu'un 403 est vu, et un checkpoint JSONL
 * (`--checkpoint`, écrit au fur et à mesure) pour ne jamais reperdre le
 * travail déjà fait si le blocage dure longtemps — relancer la même commande
 * reprend exactement où ça s'est arrêté.
 */
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const MONSTERS_PATH = path.join(projectRoot, 'referentiel', 'monsters_wakfu.json');
const FAMILIES_PATH = path.join(projectRoot, 'referentiel', 'monster-families_wakfu.json');
const DEFAULT_CHECKPOINT_PATH = path.join(os.tmpdir(), 'wakfu-monsters-scrape-checkpoint.jsonl');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const LOCALES = {
  fr: { host: 'https://www.wakfu.com/fr/mmorpg/encyclopedie/monstres', lang: 'fr-FR,fr;q=0.9' },
  en: { host: 'https://www.wakfu.com/en/mmorpg/encyclopedia/monsters', lang: 'en-US,en;q=0.9' },
  es: { host: 'https://www.wakfu.com/es/mmorpg/enciclopedia/monstruos', lang: 'es-ES,es;q=0.9' },
  pt: { host: 'https://www.wakfu.com/pt/mmorpg/enciclopedia/monstros', lang: 'pt-BR,pt;q=0.9' },
};

const WAKASSETS_MONSTERS_BASE = 'https://vertylo.github.io/wakassets/monsters';
const WAKASSETS_ILLUSTRATIONS_BASE = 'https://vertylo.github.io/wakassets/monsterIllustrations';
const WAKFU_STATIC_MONSTER_BASE = 'https://static.ankama.com/wakfu/portal/game/monster/42';

/** Critères de classification (noms FR exacts des drops, voir consigne utilisateur du 2026-08-02). */
const BOSS_EXACT_NAMES = new Set([
  "Pierre d'équilibre",
  'Pierre de vitesse',
  "Pierre d'aventure",
  "Pierre d'entourage",
  'Pierre ultime',
]);
const BOSS_PREFIX = 'Jeton';
const ARCHI_PREFIXES = ['Reliquâme', 'Archiemblème'];
const DOMINANT_MASK_TIERS = [
  'Grossier',
  'Rudimentaire',
  'Imparfait',
  'Fragile',
  'Rustique',
  'Brut',
  'Solide',
  'Durable',
  'Raffiné',
  'Précieux',
  'Exquis',
  'Mystique',
  'Eternel',
  'Divin',
  'Infernal',
];
const DOMINANT_EXACT_NAMES = new Set(DOMINANT_MASK_TIERS.map((tier) => `Masque ${tier}`));

function classifyDrops(dropNames) {
  let isBoss = false;
  let isArchi = false;
  let isDominant = false;
  for (const name of dropNames) {
    if (!isBoss && (name.startsWith(BOSS_PREFIX) || BOSS_EXACT_NAMES.has(name))) isBoss = true;
    if (!isArchi && ARCHI_PREFIXES.some((p) => name.startsWith(p))) isArchi = true;
    if (!isDominant && DOMINANT_EXACT_NAMES.has(name)) isDominant = true;
  }
  return { isBoss, isArchi, isDominant };
}

// ---------------------------------------------------------------------------
// Cookie jar minimal : wakfu.com fait rebondir toute requête sans session
// valide sur un flux SSO (account.ankama.com/sso-redirect) qui boucle
// indéfiniment si les cookies ne sont pas conservés entre les sauts. Un seul
// "warm up" en début de script suffit : le cookie de session obtenu est
// ensuite réutilisé tel quel sur toutes les requêtes suivantes (vérifié :
// pas besoin de renégocier par requête).
// ---------------------------------------------------------------------------
class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  update(setCookieHeaders) {
    for (const header of setCookieHeaders) {
      const [pair] = header.split(';');
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  toString() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

function getSetCookies(res) {
  // Node fetch (undici) expose getSetCookie(); fallback générique sinon.
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const raw = res.headers.get('set-cookie');
  return raw ? [raw] : [];
}

async function warmUp(jar, lang) {
  let url = LOCALES[lang].host;
  for (let hop = 0; hop < 10; hop++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': LOCALES[lang].lang, Cookie: jar.toString() },
      redirect: 'manual',
    });
    jar.update(getSetCookies(res));
    if (res.status >= 300 && res.status < 400) {
      url = new URL(res.headers.get('location'), url).toString();
      continue;
    }
    return; // 200 (ou autre statut terminal) : session établie.
  }
  throw new Error(`Boucle de redirection SSO non résolue après 10 sauts pour ${lang}.`);
}

/**
 * Throttle + cooldown GLOBAL (partagé par tous les workers, pas par worker) :
 * un rate-limit wakfu.com touche tout le monde en même temps, un délai
 * réparti par worker ne suffit pas à l'éviter.
 */
const rateLimiter = {
  minDelayMs: 350,
  nextAllowedAt: 0,
  blockedUntil: 0,
  consecutiveBlocks: 0,
};

async function throttle() {
  const now = () => Date.now();
  const waitUntil = Math.max(rateLimiter.nextAllowedAt, rateLimiter.blockedUntil);
  const delay = waitUntil - now();
  if (delay > 0) await sleep(delay);
  rateLimiter.nextAllowedAt = now() + rateLimiter.minDelayMs;
}

function registerBlock() {
  rateLimiter.consecutiveBlocks++;
  const cooldownMs = Math.min(30_000 * 2 ** (rateLimiter.consecutiveBlocks - 1), 15 * 60_000);
  rateLimiter.blockedUntil = Date.now() + cooldownMs;
  console.warn(
    `[scrape-monsters] HTTP 403 (rate-limit probable) — pause de ${Math.round(cooldownMs / 1000)}s avant de reprendre (blocage n°${rateLimiter.consecutiveBlocks}).`,
  );
  return cooldownMs;
}

function registerSuccess() {
  rateLimiter.consecutiveBlocks = 0;
}

async function fetchHtml(url, jar, lang, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await throttle();
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': LOCALES[lang].lang, Cookie: jar.toString() },
    });
    if (res.ok) {
      registerSuccess();
      return res.text();
    }
    if (res.status === 403) {
      registerBlock();
      continue;
    }
    if (res.status >= 300 && res.status < 400) {
      // Session expirée en cours de route : on la renégocie puis on retente.
      await warmUp(jar, lang);
      continue;
    }
    if (attempt === attempts - 1) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  }
  throw new Error(`GET ${url} -> échec après ${attempts} tentatives (probablement bloqué durablement)`);
}

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compteur d'avancement mis à jour sur une seule ligne (retour chariot \r,
 * pas de \n) plutôt qu'un log périodique qui empilerait des lignes — voulu
 * explicitement (session du 2026-08-02) pour un affichage compact pendant
 * les runs longs (~850 monstres). N'ajoute donc jamais de nouvelle ligne
 * tant que `done < total` ; un `\n` final est écrit une fois le run terminé
 * (voir l'appelant) pour ne pas mélanger la suite des logs avec cette ligne.
 */
function printProgress(done, total) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 100;
  process.stdout.write(`\r  ${done}/${total} monstres scrapés (${pct}%)`.padEnd(60));
}

// ---------------------------------------------------------------------------
// Étape 1 : liste paginée des monstres (id, nom, famille, gfxId, slug URL)
// pour une locale donnée.
// ---------------------------------------------------------------------------
async function scrapeMonsterList(jar, lang, { limitPages } = {}) {
  const results = new Map(); // id -> { id, name, family, gfxId, slug }
  let pageNum = 1;
  let totalPages = 1;
  do {
    const url = `${LOCALES[lang].host}?page=${pageNum}`;
    const html = await fetchHtml(url, jar, lang);
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    if (pageNum === 1) {
      const pageOptions = doc.querySelectorAll('select.ak-select-page option');
      for (const opt of pageOptions) {
        const n = Number(opt.textContent.trim());
        if (Number.isFinite(n) && n > totalPages) totalPages = n;
      }
    }

    const rows = doc.querySelectorAll('tbody tr');
    for (const row of rows) {
      const link = row.querySelector('td:nth-child(2) a[href*="/monstres/"], td:nth-child(2) a[href*="/monsters/"], td:nth-child(2) a[href*="/monstruos/"], td:nth-child(2) a[href*="/monstros/"]');
      if (!link) continue;
      const href = link.getAttribute('href');
      const match = href.match(/(\d+)-([^/?]+)/);
      if (!match) continue;
      const id = Number(match[1]);
      const slug = match[2];
      const name = link.textContent.trim();

      const img = row.querySelector('td:nth-child(1) img');
      const gfxMatch = img?.getAttribute('src')?.match(/(\d+)\.png$/);
      const gfxId = gfxMatch ? gfxMatch[1] : null;

      const familyCell = row.querySelector('td.item-type');
      const family = familyCell?.textContent.trim() || null;

      results.set(id, { id, name, family, gfxId, slug });
    }

    pageNum++;
    if (limitPages && pageNum > limitPages) break;
    await sleep(120);
  } while (pageNum <= totalPages);

  return results;
}

// ---------------------------------------------------------------------------
// Étape 2 : page "butin" d'un monstre -> noms d'objets droppés (FR only, les
// critères isBoss/isArchi/isDominant sont donnés en FR par l'utilisateur).
// ---------------------------------------------------------------------------
async function scrapeMonsterDrops(jar, slugFr, id) {
  const dropNames = [];
  let pageNum = 1;
  for (;;) {
    const url = `https://www.wakfu.com/fr/mmorpg/encyclopedie/monstres/${id}-${slugFr}/butin${pageNum > 1 ? `?page=${pageNum}` : ''}`;
    const html = await fetchHtml(url, jar, 'fr');
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const links = doc.querySelectorAll('a[href*="/encyclopedie/"]');
    for (const a of links) {
      const href = a.getAttribute('href');
      if (href.includes('/encyclopedie/monstres/')) continue; // monstres "liés", pas un drop
      const span = a.querySelector('span.ak-linker');
      if (span) dropNames.push(span.textContent.trim());
    }

    const nextLink = doc.querySelector('.ak-pagination a[href*="page="]');
    const hasNext = [...doc.querySelectorAll('.ak-pagination a')].some(
      (a) => a.textContent.trim() === '»' && a.getAttribute('href')?.includes(`page=${pageNum + 1}`),
    );
    if (!hasNext || !nextLink) break;
    pageNum++;
    await sleep(120);
  }
  return dropNames;
}

async function loadCheckpoint(checkpointPath) {
  const map = new Map();
  if (!existsSync(checkpointPath)) return map;
  const content = await readFile(checkpointPath, 'utf-8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    map.set(record.id, record);
  }
  return map;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : null;
  const concurrencyArg = args.find((a) => a.startsWith('--concurrency='));
  const concurrency = concurrencyArg ? Number(concurrencyArg.split('=')[1]) : 2;
  const checkpointArg = args.find((a) => a.startsWith('--checkpoint='));
  const checkpointPath = checkpointArg ? checkpointArg.split('=')[1] : DEFAULT_CHECKPOINT_PATH;
  const limitPages = limit ? Math.ceil(limit / 25) : null;

  const jars = { fr: new CookieJar(), en: new CookieJar(), es: new CookieJar(), pt: new CookieJar() };
  console.log('Établissement des sessions (contournement SSO wakfu.com)...');
  await Promise.all(Object.entries(jars).map(([lang, jar]) => warmUp(jar, lang)));

  console.log('Scan de la liste des monstres (FR)...');
  const frList = await scrapeMonsterList(jars.fr, 'fr', { limitPages });
  console.log(`${frList.size} monstres trouvés (FR).`);

  console.log('Scan de la liste des monstres (EN/ES/PT) pour les traductions...');
  const [enList, esList, ptList] = await Promise.all([
    scrapeMonsterList(jars.en, 'en', { limitPages }),
    scrapeMonsterList(jars.es, 'es', { limitPages }),
    scrapeMonsterList(jars.pt, 'pt', { limitPages }),
  ]);

  const checkpoint = await loadCheckpoint(checkpointPath);
  if (checkpoint.size > 0) {
    console.log(`Checkpoint trouvé (${checkpointPath}) : ${checkpoint.size} monstres déjà traités, reprise.`);
  }

  const ids = [...frList.keys()];
  const remainingIds = ids.filter((id) => !checkpoint.has(id));
  console.log(
    `Récupération du butin pour ${remainingIds.length} monstres restants sur ${ids.length} (concurrence ${concurrency})...`,
  );
  let done = checkpoint.size;
  await mapWithConcurrency(remainingIds, concurrency, async (id) => {
    const fr = frList.get(id);
    const drops = await scrapeMonsterDrops(jars.fr, fr.slug, id);
    const { isBoss, isArchi, isDominant } = classifyDrops(drops);

    const gfxId = fr.gfxId;
    const [wakassetsAvailable, wakfuAvailable] = gfxId
      ? await Promise.all([
          Promise.all([headOk(`${WAKASSETS_MONSTERS_BASE}/${gfxId}.png`), headOk(`${WAKASSETS_ILLUSTRATIONS_BASE}/${gfxId}.png`)]).then(
            ([a, b]) => a || b,
          ),
          headOk(`${WAKFU_STATIC_MONSTER_BASE}/${gfxId}.png`),
        ])
      : [false, false];

    const record = {
      id,
      fr: fr.name,
      en: enList.get(id)?.name ?? fr.name,
      es: esList.get(id)?.name ?? fr.name,
      pt: ptList.get(id)?.name ?? fr.name,
      familyFr: fr.family,
      familyEn: enList.get(id)?.family ?? null,
      familyEs: esList.get(id)?.family ?? null,
      familyPt: ptList.get(id)?.family ?? null,
      gfxId,
      picture_url: gfxId ? `${WAKFU_STATIC_MONSTER_BASE}/${gfxId}.png` : null,
      wakassets_available: wakassetsAvailable,
      wakfu_available: wakfuAvailable,
      isBoss,
      isArchi,
      isDominant,
    };

    checkpoint.set(id, record);
    await appendFile(checkpointPath, JSON.stringify(record) + '\n', 'utf-8');

    done++;
    printProgress(done, ids.length);

    return record;
  });
  if (ids.length > 0) process.stdout.write('\n');

  // --- Référentiel des familles : id incrémental par nom FR distinct, résolu
  // en une passe finale (checkpoint + frais confondus) pour rester cohérent
  // même après reprise d'un checkpoint issu d'une exécution précédente. ---
  const familyByFr = new Map(); // fr name -> { id, fr, en, es, pt }
  let nextFamilyId = 1;
  const rawMonsters = ids.map((id) => checkpoint.get(id)).filter(Boolean);
  rawMonsters.sort((a, b) => a.id - b.id);

  const monsters = rawMonsters.map((m) => {
    let familyId = null;
    if (m.familyFr) {
      if (!familyByFr.has(m.familyFr)) {
        familyByFr.set(m.familyFr, {
          id: nextFamilyId++,
          fr: m.familyFr,
          en: m.familyEn,
          es: m.familyEs,
          pt: m.familyPt,
        });
      }
      familyId = familyByFr.get(m.familyFr).id;
    }
    return {
      id: m.id,
      fr: m.fr,
      en: m.en,
      es: m.es,
      pt: m.pt,
      family: familyId,
      gfxId: m.gfxId,
      picture_url: m.picture_url,
      wakassets_available: m.wakassets_available,
      wakfu_available: m.wakfu_available,
      isBoss: m.isBoss,
      isArchi: m.isArchi,
      isDominant: m.isDominant,
    };
  });
  const families = [...familyByFr.values()].sort((a, b) => a.id - b.id);

  console.log(`${monsters.length} monstres, ${families.length} familles distinctes.`);
  console.log(`  isBoss: ${monsters.filter((m) => m.isBoss).length}`);
  console.log(`  isArchi: ${monsters.filter((m) => m.isArchi).length}`);
  console.log(`  isDominant: ${monsters.filter((m) => m.isDominant).length}`);

  if (dryRun) {
    console.log('[dry-run] Aucune écriture.');
    console.log(monsters.slice(0, 5));
    return;
  }

  await writeFile(MONSTERS_PATH, JSON.stringify(monsters, null, 2) + '\n', 'utf-8');
  await writeFile(FAMILIES_PATH, JSON.stringify(families, null, 2) + '\n', 'utf-8');
  console.log(`Écrit : ${MONSTERS_PATH}`);
  console.log(`Écrit : ${FAMILIES_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
