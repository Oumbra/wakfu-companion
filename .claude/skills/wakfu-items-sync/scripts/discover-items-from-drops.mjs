#!/usr/bin/env node
/**
 * Complète referentiel/items_wakfu.json avec des objets ABSENTS de
 * jobsItems.json/items.json (voir SKILL.md, section "Trouver des objets
 * absents de jobsItems.json") via trois sources HTML complémentaires :
 *   1. drops de TOUS les monstres (referentiel/monsters_wakfu.json)
 *   2. listings paginés des catégories encyclopédie : personnalisation,
 *      armures, armes, familiers, accessoires, consommables, ressources,
 *      divers
 *   3. pages "recettes" des 8 métiers d'artisanat (découvertes dynamiquement
 *      depuis /encyclopedie/metiers, jamais codées en dur) — redondant à
 *      ~100% avec jobsItems.json (voir sync-items.mjs) mais gardé pour
 *      détecter un éventuel objet publié sur le site avant sa publication
 *      dans le gamedata
 *
 * Contrairement à sync-items.mjs (gamedata JSON, rapide, ~1-3 min), ce
 * script scrape du HTML sur wakfu.com : lent (throttle + backoff volontaires
 * pour éviter le blocage anti-bot, voir SKILL.md), prévoir plusieurs heures
 * pour un run complet. Reprenable via checkpoint JSONL.
 *
 * Usage :
 *   node .claude/skills/wakfu-items-sync/scripts/discover-items-from-drops.mjs --dry-run --limit=20
 *   node .claude/skills/wakfu-items-sync/scripts/discover-items-from-drops.mjs [--checkpoint=path] [--skip-monster-drops] [--skip-categories] [--skip-metiers]
 *
 * N'écrit dans referentiel/items_wakfu.json qu'à la toute fin (une fois tous
 * les candidats résolus), en AJOUTANT uniquement (jamais de modification
 * d'une entrée existante) — même politique que sync-items.mjs.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const ITEMS_PATH = path.join(projectRoot, 'referentiel', 'items_wakfu.json');
const MONSTERS_PATH = path.join(projectRoot, 'referentiel', 'monsters_wakfu.json');
const DEFAULT_CHECKPOINT_PATH = path.join(os.tmpdir(), 'wakfu-items-discover-checkpoint.jsonl');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const MONSTER_URL_BY_LOCALE = {
  fr: (id) => `https://www.wakfu.com/fr/mmorpg/encyclopedie/monstres/${id}/butin`,
  en: (id) => `https://www.wakfu.com/en/mmorpg/encyclopedia/monsters/${id}/butin`,
  es: (id) => `https://www.wakfu.com/es/mmorpg/enciclopedia/monstruos/${id}/butin`,
  pt: (id) => `https://www.wakfu.com/pt/mmorpg/enciclopedia/monstros/${id}/butin`,
};
const MONSTER_HOST_BY_LOCALE = {
  fr: 'https://www.wakfu.com/fr/mmorpg/encyclopedie/monstres',
  en: 'https://www.wakfu.com/en/mmorpg/encyclopedia/monsters',
  es: 'https://www.wakfu.com/es/mmorpg/enciclopedia/monstruos',
  pt: 'https://www.wakfu.com/pt/mmorpg/enciclopedia/monstros',
};

/** Catégories encyclopédie à scanner intégralement (listing paginé FR — les
 * noms en/es/pt sont résolus par objet via sa fiche propre + hreflang, pas
 * en re-crawlant le listing dans chaque locale). */
const CATEGORY_SLUGS = [
  'personnalisation',
  'armures',
  'armes',
  'familiers',
  'accessoires',
  'consommables',
  'ressources',
  'divers',
];
const METIERS_URL = 'https://www.wakfu.com/fr/mmorpg/encyclopedie/metiers';

/** Libellé FR brut (attribut title du span de rareté) -> WakfuRarity. Doit rester cohérent avec wakfu-item-rarity.data.ts. */
const RARITY_MAP = {
  'qualité commune': 'old',
  inhabituel: 'common',
  rare: 'rare',
  mythique: 'mythical',
  légendaire: 'legendary',
  legendaire: 'legendary',
  relique: 'relic',
  pvp: 'memory',
  épique: 'epic',
  epique: 'epic',
};
/**
 * Repli quand le span de rareté n'a pas d'attribut title (constaté sur les
 * fiches "personnalisation", contrairement aux listes de drops/catégories
 * qui l'ont) : ordre canonique des paliers Ankama (classe CSS ak-rarity-N).
 */
const RARITY_BY_NUMBER = {
  0: 'old',
  1: 'common',
  2: 'rare',
  3: 'mythical',
  4: 'legendary',
  5: 'relic',
  6: 'memory',
  7: 'epic',
};

function rarityFromTitle(titleFr) {
  if (!titleFr) return null;
  return RARITY_MAP[titleFr.toLowerCase().trim()] ?? null;
}

function normalizeWakfuName(name) {
  return name.toLowerCase().trim().replace(/[’‘]/g, "'");
}

// --- cookie jar + throttle global + backoff : voir scripts/scrape-monsters.mjs
// de wakfu-monsters-sync, mêmes mécanismes (SSO + WAF wakfu.com). ---

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
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const raw = res.headers.get('set-cookie');
  return raw ? [raw] : [];
}

async function warmUp(jar, url) {
  let current = url;
  for (let hop = 0; hop < 10; hop++) {
    const res = await fetch(current, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'fr,fr-FR;q=0.9', Cookie: jar.toString() },
      redirect: 'manual',
    });
    jar.update(getSetCookies(res));
    if (res.status >= 300 && res.status < 400) {
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    return;
  }
  throw new Error(`Boucle de redirection SSO non résolue après 10 sauts pour ${url}.`);
}

/**
 * Throttle bien plus conservateur (2s de base, cf. minDelayMs) que celui de
 * scrape-monsters.mjs (350ms) : l'environnement d'origine de ce script a
 * scrapé ~850 pages monstre en séquentiel (pas de concurrence) avec un délai
 * de ~5s sans jamais déclencher le blocage global de 45+ minutes constaté
 * lors du scraping des monstres (voir wakfu-monsters-sync/SKILL.md) — signe
 * que c'est la CADENCE, pas juste le nombre de requêtes, qui déclenche le
 * WAF. Si ce script se bloque quand même, ne pas insister : reproduire la
 * méthode Playwright MCP (browser_evaluate) documentée dans
 * wakfu-monsters-sync/SKILL.md plutôt que d'augmenter les délais à l'infini.
 */
const rateLimiter = { minDelayMs: 2000, nextAllowedAt: 0, blockedUntil: 0, consecutiveBlocks: 0 };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle() {
  const now = () => Date.now();
  const waitUntil = Math.max(rateLimiter.nextAllowedAt, rateLimiter.blockedUntil);
  const delay = waitUntil - now();
  if (delay > 0) await sleep(delay);
  rateLimiter.nextAllowedAt = now() + rateLimiter.minDelayMs + Math.random() * 1000;
}

function registerBlock() {
  rateLimiter.consecutiveBlocks++;
  const cooldownMs = Math.min(30_000 * 2 ** (rateLimiter.consecutiveBlocks - 1), 15 * 60_000);
  rateLimiter.blockedUntil = Date.now() + cooldownMs;
  console.warn(
    `[discover-items] HTTP 403/429 — pause de ${Math.round(cooldownMs / 1000)}s (blocage n°${rateLimiter.consecutiveBlocks}).`,
  );
  return cooldownMs;
}

function registerSuccess() {
  rateLimiter.consecutiveBlocks = 0;
}

async function fetchHtml(url, jar, attempts = 8) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await throttle();
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'fr,fr-FR;q=0.9', Cookie: jar.toString() },
    });
    if (res.ok) {
      registerSuccess();
      return res.text();
    }
    if (res.status === 404) return null; // page absente : pas la peine de retenter
    if (res.status === 403 || res.status === 429) {
      registerBlock();
      continue;
    }
    if (res.status >= 300 && res.status < 400) {
      await warmUp(jar, url);
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
      // transitoire, on retente
    }
  }
  return false;
}

function printProgress(done, total, label) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 100;
  process.stdout.write(`\r  [${label}] ${done}/${total} (${pct}%)`.padEnd(70));
}

function addCandidate(checkpoint, candidate, source) {
  if (checkpoint.candidates[candidate.itemId]) return; // premier trouvé gagne, jamais écrasé
  checkpoint.candidates[candidate.itemId] = { ...candidate, source };
}

// --- Drops de monstres : page /butin paginée, exclusion des monstres "liés"
// (pas un vrai drop). NB : la catégorie peut être une chaîne vide dans le
// href (ex. "Fragment de Havre-Gemme Jardin" sur le monstre Vilenya, bug
// constaté sur une version antérieure de ce script qui exigeait une
// catégorie non vide dans sa regex et perdait silencieusement ces objets) —
// ne jamais re-imposer `[a-z]+` non vide sur ce segment. ---

function parseDropsPage(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const drops = [];
  for (const a of doc.querySelectorAll('a[href*="/encyclopedie/"], a[href*="/encyclopedia/"], a[href*="/enciclopedia/"]')) {
    const href = a.getAttribute('href');
    if (/\/(encyclopedie|encyclopedia|enciclopedia)\/(monstres|monsters|monstruos|monstros)\//.test(href)) continue; // monstre "lié", pas un drop
    const m = href.match(/\/(?:encyclopedie|encyclopedia|enciclopedia)\/([a-z]*)\/?(\d+)-([^"?]+)/);
    if (!m) continue;
    const [, category, itemIdStr, slug] = m;
    const span = a.querySelector('span.ak-linker');
    const name = span?.textContent.trim();
    if (!name) continue;
    const img = a.parentElement?.querySelector('img[src*="/item/"]') ?? a.querySelector('img[src*="/item/"]');
    const gfxMatch = img?.getAttribute('src')?.match(/\/item\/\d+\/(\d+)\.(?:w40h40\.)?png/);
    const raritySpan = a.parentElement?.querySelector('span[class*="ak-rarity-"]');
    const rarityClass = raritySpan?.className.match(/ak-rarity-(\d+)/);
    drops.push({
      itemId: Number(itemIdStr),
      category, // peut être '' : page objet propre absente sur le site, résolue via fallback (voir resolveCandidate)
      slug,
      gfxId: gfxMatch ? gfxMatch[1] : null,
      nameFr: name,
      rarityTitle: raritySpan?.getAttribute('title') ?? null,
      rarityNumber: rarityClass ? Number(rarityClass[1]) : null,
    });
  }
  const hasNext = [...doc.querySelectorAll('.ak-pagination a')].some((a) => a.textContent.trim() === '»');
  return { drops, hasNext };
}

async function scrapeMonsterDropsFull(jar, id, locale = 'fr') {
  const all = [];
  let pageNum = 1;
  for (;;) {
    const url = `${MONSTER_URL_BY_LOCALE[locale](id)}${pageNum > 1 ? `?page=${pageNum}` : ''}`;
    const html = await fetchHtml(url, jar);
    if (!html) break;
    const { drops, hasNext } = parseDropsPage(html);
    all.push(...drops);
    if (!hasNext) break;
    pageNum++;
  }
  return all;
}

// --- Listings de catégorie / recettes de métier : table `tbody tr` avec un
// lien icône (texte vide, à ignorer) et un lien nom (texte non vide) — voir
// vérification en direct (session 2026-08-02, page /armures) : le premier
// `<a>` du <tr> pointe sur l'icône SANS texte, le second sur le nom. Un
// `querySelector` naïf sur "le premier <a>" (comme une version antérieure
// non testée de ce script) capture l'icône et perd silencieusement l'objet
// (texte vide -> filtré). Toujours choisir le premier lien à texte NON VIDE
// et jamais le premier lien tout court. Sur les pages de recettes de métier,
// des liens d'ingrédients (texte "x1", "x10"...) suivent le lien du nom dans
// le DOM : comme on prend le PREMIER lien à texte non vide, on capture
// systématiquement le résultat de la recette, jamais un ingrédient. Pagination
// détectée via `select.ak-select-page` (même technique que
// wakfu-monsters-sync/scripts/scrape-monsters.mjs `scrapeMonsterList`), plus
// robuste que la recherche d'une flèche "»" (absente sur ces gabarits).
function parseListingTable(html, fallbackCategory) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const items = [];
  for (const row of doc.querySelectorAll('tbody tr')) {
    const links = [...row.querySelectorAll('a[href*="/mmorpg/encyclopedie/"]')];
    const nameLink = links.find((a) => a.textContent.trim().length > 0);
    if (!nameLink) continue;
    const href = nameLink.getAttribute('href');
    const m = href.match(/\/encyclopedie\/([a-z]*)\/?(\d+)-?([^"?]*)/);
    if (!m) continue;
    const [, hrefCategory, itemIdStr, slug] = m;
    const gfxMatch = row.cells?.[0]
      ?.querySelector('img[src*="/item/"]')
      ?.getAttribute('src')
      ?.match(/\/item\/\d+\/(\d+)\.(?:w40h40\.)?png/);
    const raritySpan = row.querySelector('span[class*="ak-rarity-"]');
    const rarityClass = raritySpan?.className.match(/ak-rarity-(\d+)/);
    if (!gfxMatch) continue;
    items.push({
      itemId: Number(itemIdStr),
      category: hrefCategory || fallbackCategory,
      slug: slug || '',
      gfxId: gfxMatch[1],
      nameFr: nameLink.textContent.trim(),
      rarityTitle: raritySpan?.getAttribute('title') ?? null,
      rarityNumber: rarityClass ? Number(rarityClass[1]) : null,
    });
  }
  let totalPages = 1;
  for (const opt of doc.querySelectorAll('select.ak-select-page option')) {
    const n = Number(opt.textContent.trim());
    if (Number.isFinite(n) && n > totalPages) totalPages = n;
  }
  return { items, totalPages };
}

async function crawlListingPages(jar, baseUrl, fallbackCategory, maxPages = 200) {
  const byId = new Map();
  let page = 1;
  let totalPages = 1;
  do {
    const url = `${baseUrl}${page > 1 ? `${baseUrl.includes('?') ? '&' : '?'}page=${page}` : ''}`;
    const html = await fetchHtml(url, jar);
    if (!html) break;
    const result = parseListingTable(html, fallbackCategory);
    if (page === 1) totalPages = Math.min(result.totalPages, maxPages);
    for (const it of result.items) if (!byId.has(it.itemId)) byId.set(it.itemId, it);
    page++;
  } while (page <= totalPages);
  return byId;
}

/**
 * Découvre dynamiquement les URLs "recettes" des 8 métiers d'artisanat
 * depuis /encyclopedie/metiers, plutôt que de coder les slugs en dur
 * (fragile si Ankama renomme/ajoute un métier) — vérifié en session
 * (2026-08-02) : la page liste déjà les liens `.../metiers/{id}-{slug}/recettes`
 * directement, pas besoin d'une étape de découverte à 2 niveaux.
 */
async function discoverMetierRecetteUrls(jar) {
  const html = await fetchHtml(METIERS_URL, jar);
  if (!html) return [];
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const hrefs = [...doc.querySelectorAll('a[href*="/mmorpg/encyclopedie/metiers/"][href*="/recettes"]')]
    .map((a) => a.getAttribute('href'))
    .filter((href, i, arr) => href && arr.indexOf(href) === i);
  return hrefs.map((href) => new URL(href, 'https://www.wakfu.com').toString());
}

function extractH1Name(html) {
  const m = html.match(/<h1 class="ak-return-link">([\s\S]*?)<\/h1>/);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

function extractTitleName(html) {
  const m = html.match(/<title>([^<]+)<\/title>/);
  return m ? m[1].split(' - ')[0].trim() : null;
}

function extractHreflangUrls(html) {
  const urls = {};
  const re = /<link rel="alternate" href="([^"]+)" hreflang="(en|es|pt)"\s*\/?>/g;
  let m;
  while ((m = re.exec(html))) urls[m[2]] = m[1];
  return urls;
}

function extractOwnRarity(html) {
  const m = html.match(/ak-icon-small ak-rarity-(\d+)"(?:\s+title="([^"]*)")?\s*><\/span>/);
  if (!m) return null;
  const [, num, title] = m;
  return rarityFromTitle(title) ?? RARITY_BY_NUMBER[Number(num)] ?? null;
}

/**
 * Résout un candidat (quelle que soit sa source : drop de monstre, listing
 * de catégorie, recette de métier) en entrée complète (fr/en/es/pt +
 * rareté). Deux chemins :
 * - catégorie connue -> fiche objet propre (résout aussi en/es/pt via
 *   hreflang) ;
 * - catégorie vide / fiche 404 -> repli sur la page de butin du monstre
 *   d'origine (uniquement si `candidate.foundOnMonster` est renseigné, donc
 *   uniquement pour les candidats issus des drops de monstres), relue dans
 *   chaque locale (en/es/pt), le nom de l'objet y apparaît toujours même
 *   sans fiche dédiée. Pour un candidat de catégorie/métier sans monstre
 *   d'origine et sans fiche exploitable, on garde le nom FR pour les 4
 *   langues plutôt que d'échouer (cas très rare, aucune catégorie/métier
 *   scannée n'a de fiche manquante à ce jour).
 */
async function resolveCandidate(jar, candidate) {
  let names = null;
  let rarity = rarityFromTitle(candidate.rarityTitle) ?? RARITY_BY_NUMBER[candidate.rarityNumber] ?? null;

  if (candidate.category) {
    const frUrl = `https://www.wakfu.com/fr/mmorpg/encyclopedie/${candidate.category}/${candidate.itemId}-${candidate.slug}`;
    const frHtml = await fetchHtml(frUrl, jar);
    if (frHtml) {
      const nameFr = extractH1Name(frHtml) || extractTitleName(frHtml) || candidate.nameFr;
      rarity = extractOwnRarity(frHtml) ?? rarity;
      const hreflang = extractHreflangUrls(frHtml);
      names = { fr: nameFr, en: nameFr, es: nameFr, pt: nameFr };
      for (const lang of ['en', 'es', 'pt']) {
        const url = hreflang[lang];
        if (!url) continue;
        const html2 = await fetchHtml(url, jar);
        if (!html2) continue;
        const name = extractH1Name(html2) || extractTitleName(html2);
        if (name) names[lang] = name;
      }
    }
  }

  if (!names && candidate.foundOnMonster) {
    names = { fr: candidate.nameFr, en: candidate.nameFr, es: candidate.nameFr, pt: candidate.nameFr };
    for (const lang of ['en', 'es', 'pt']) {
      const drops = await scrapeMonsterDropsFull(jar, candidate.foundOnMonster, lang);
      const match = drops.find((d) => d.itemId === candidate.itemId);
      if (match) names[lang] = match.nameFr;
    }
  }

  if (!names) {
    names = { fr: candidate.nameFr, en: candidate.nameFr, es: candidate.nameFr, pt: candidate.nameFr };
  }

  return { names, rarity: rarity ?? 'common', gfxId: candidate.gfxId };
}

async function main() {
  const fs = await import('node:fs/promises');
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipMonsterDrops = args.includes('--skip-monster-drops');
  const skipCategories = args.includes('--skip-categories');
  const skipMetiers = args.includes('--skip-metiers');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : null;
  const checkpointArg = args.find((a) => a.startsWith('--checkpoint='));
  const checkpointPath = checkpointArg ? checkpointArg.split('=')[1] : DEFAULT_CHECKPOINT_PATH;

  const existingItems = JSON.parse(await fs.readFile(ITEMS_PATH, 'utf-8'));
  const existingNormalizedNames = new Set(existingItems.map((it) => normalizeWakfuName(it.fr)));
  const existingIds = new Set(existingItems.map((it) => it.id).filter((id) => id !== undefined));
  const monsters = JSON.parse(await fs.readFile(MONSTERS_PATH, 'utf-8'));
  const monsterIds = (limit ? monsters.slice(0, limit) : monsters).map((m) => m.id);

  console.log(`Référentiel actuel : ${existingItems.length} objets.`);

  const jar = new CookieJar();
  await warmUp(jar, MONSTER_HOST_BY_LOCALE.fr);

  // --- Checkpoint : { candidates: {itemId: {...}}, resolved: {itemId: entry}, monstersDone: [ids], categoriesDone: [slugs], metiersDone: bool } ---
  let checkpoint = { candidates: {}, resolved: {}, monstersDone: [], categoriesDone: [], metiersDone: false };
  if (existsSync(checkpointPath)) {
    checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf-8'));
    checkpoint.categoriesDone ??= [];
    checkpoint.metiersDone ??= false;
    console.log(
      `Checkpoint trouvé : ${checkpoint.monstersDone.length} monstres, ${checkpoint.categoriesDone.length} catégories, métiers=${checkpoint.metiersDone} déjà scannés — ${Object.keys(checkpoint.candidates).length} candidats, ${Object.keys(checkpoint.resolved).length} résolus.`,
    );
  }
  const monstersDoneSet = new Set(checkpoint.monstersDone);
  const categoriesDoneSet = new Set(checkpoint.categoriesDone);

  async function saveCheckpoint() {
    await fs.writeFile(checkpointPath, JSON.stringify(checkpoint), 'utf-8');
  }

  const normFilter = (nameFr) => !existingNormalizedNames.has(normalizeWakfuName(nameFr));
  const idFilter = (itemId) => !existingIds.has(itemId);

  // --- Phase 1 : drops de tous les monstres ---
  if (!skipMonsterDrops) {
    const remainingMonsters = monsterIds.filter((id) => !monstersDoneSet.has(id));
    let doneMonsters = monstersDoneSet.size;
    for (const monsterId of remainingMonsters) {
      const drops = await scrapeMonsterDropsFull(jar, monsterId, 'fr');
      for (const d of drops) {
        if (!normFilter(d.nameFr) || !idFilter(d.itemId)) continue;
        addCandidate(checkpoint, { ...d, foundOnMonster: monsterId }, 'monster-drop');
      }
      monstersDoneSet.add(monsterId);
      checkpoint.monstersDone = [...monstersDoneSet];
      doneMonsters++;
      printProgress(doneMonsters, monsterIds.length, 'monstres');
      await saveCheckpoint();
    }
    if (monsterIds.length > 0) process.stdout.write('\n');
    console.log(`Phase 1 (drops) terminée : ${Object.keys(checkpoint.candidates).length} candidats cumulés.`);
  }

  // --- Phase 2 : catégories encyclopédie (listing paginé complet) ---
  if (!skipCategories) {
    for (const slug of CATEGORY_SLUGS) {
      if (categoriesDoneSet.has(slug)) continue;
      const baseUrl = `https://www.wakfu.com/fr/mmorpg/encyclopedie/${slug}`;
      const items = await crawlListingPages(jar, baseUrl, slug);
      let added = 0;
      for (const it of items.values()) {
        if (!normFilter(it.nameFr) || !idFilter(it.itemId)) continue;
        addCandidate(checkpoint, it, `category:${slug}`);
        added++;
      }
      categoriesDoneSet.add(slug);
      checkpoint.categoriesDone = [...categoriesDoneSet];
      await saveCheckpoint();
      console.log(`Catégorie "${slug}" : ${items.size} objets listés, ${added} nouveaux candidats.`);
    }
  }

  // --- Phase 3 : recettes des 8 métiers d'artisanat (découverte dynamique) ---
  if (!skipMetiers && !checkpoint.metiersDone) {
    const recetteUrls = await discoverMetierRecetteUrls(jar);
    console.log(`Métiers : ${recetteUrls.length} pages de recettes découvertes.`);
    for (const url of recetteUrls) {
      const items = await crawlListingPages(jar, url, ''); // catégorie réelle prise dans le href du résultat, pas de repli fixe pertinent ici
      let added = 0;
      for (const it of items.values()) {
        if (!it.category) continue; // repli '' inutilisable sans monstre d'origine, ignoré plutôt que mal résolu
        if (!normFilter(it.nameFr) || !idFilter(it.itemId)) continue;
        addCandidate(checkpoint, it, `metier:${url}`);
        added++;
      }
      console.log(`  ${url} : ${items.size} résultats de recette, ${added} nouveaux candidats.`);
    }
    checkpoint.metiersDone = true;
    await saveCheckpoint();
  }

  // --- Phase 4 : résolution multilingue de tous les candidats cumulés ---
  const candidateEntries = Object.values(checkpoint.candidates);
  let doneResolve = Object.keys(checkpoint.resolved).length;
  for (const cand of candidateEntries) {
    if (checkpoint.resolved[cand.itemId]) continue;
    const { names, rarity, gfxId } = await resolveCandidate(jar, cand);
    checkpoint.resolved[cand.itemId] = { id: cand.itemId, ...names, rarity, gfxId };
    doneResolve++;
    printProgress(doneResolve, candidateEntries.length, 'résolution');
    await saveCheckpoint();
  }
  if (candidateEntries.length > 0) process.stdout.write('\n');

  // --- Écriture finale : ajout au référentiel (jamais de modification d'entrée existante) ---
  const newEntries = [];
  for (const entry of Object.values(checkpoint.resolved)) {
    if (existingIds.has(entry.id)) continue; // déjà ajouté par une exécution précédente/en parallèle
    const pictureUrl = `https://static.ankama.com/wakfu/portal/game/item/42/${entry.gfxId}.w40h40.png`;
    const wakassetsAvailable = await headOk(`https://vertylo.github.io/wakassets/items/${entry.gfxId}.png`);
    const wakfuAvailable = await headOk(pictureUrl);
    newEntries.push({
      id: entry.id,
      fr: entry.fr,
      en: entry.en,
      es: entry.es,
      pt: entry.pt,
      rarity: entry.rarity,
      gfxId: String(entry.gfxId),
      picture_url: pictureUrl,
      wakassets_available: wakassetsAvailable,
      wakfu_available: wakfuAvailable,
    });
  }
  newEntries.sort((a, b) => a.id - b.id);

  console.log(`${newEntries.length} nouvelles entrées prêtes à être ajoutées au référentiel.`);
  if (dryRun) {
    console.log('[dry-run] Aucune écriture.');
    console.log(newEntries.slice(0, 10));
    return;
  }
  if (newEntries.length === 0) return;

  const merged = [...existingItems, ...newEntries];
  await fs.writeFile(ITEMS_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  console.log(`Écrit : ${ITEMS_PATH} (${merged.length} objets au total, +${newEntries.length}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
