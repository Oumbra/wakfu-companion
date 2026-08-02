/**
 * Template à coller tel quel dans le paramètre `function` de
 * mcp__playwright__browser_evaluate, en remplaçant UNIQUEMENT le contenu de
 * CHUNK par celui d'un chunk_N.json généré par split-chunks.mjs (copier-coller
 * direct, c'est déjà du JSON valide = JS valide).
 *
 * Passer aussi `filename: "monsters-drops-chunkN.json"` à browser_evaluate
 * (N = index du chunk) pour écrire le résultat sur disque plutôt que de
 * l'inonder dans le contexte de conversation.
 *
 * Session de référence (2026-08-02) : navigue d'abord vers n'importe quelle
 * page wakfu.com (browser_navigate) pour établir la session avant le premier
 * appel de ce template — sinon le premier fetch() peut retomber sur le flux
 * SSO. Si "Target page, context or browser has been closed" apparaît en
 * cours de route, un simple browser_navigate de récupération suffit avant de
 * retenter le même chunk (rien n'est perdu, les chunks précédents sont déjà
 * sur disque).
 */
async () => {
  const BOSS_EXACT = new Set([
    "Pierre d'équilibre",
    'Pierre de vitesse',
    "Pierre d'aventure",
    "Pierre d'entourage",
    'Pierre ultime',
  ]);
  const ARCHI_PREFIXES = ['Reliquâme', 'Archiemblème'];
  const MASK_TIERS = [
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
  const DOMINANT_EXACT = new Set(MASK_TIERS.map((t) => `Masque ${t}`));

  async function scrapeDrops(id, slug) {
    const dropNames = [];
    let pageNum = 1;
    for (;;) {
      const url = `https://www.wakfu.com/fr/mmorpg/encyclopedie/monstres/${id}-${slug}/butin${pageNum > 1 ? `?page=${pageNum}` : ''}`;
      const html = await fetch(url).then((r) => r.text());
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const a of doc.querySelectorAll('a[href*="/encyclopedie/"]')) {
        const href = a.getAttribute('href');
        if (href.includes('/encyclopedie/monstres/')) continue; // monstre "lié", pas un drop
        const span = a.querySelector('span.ak-linker');
        const t = span?.textContent.trim();
        if (t) dropNames.push(t);
      }
      const hasNext = [...doc.querySelectorAll('.ak-pagination a')].some(
        (a) => a.textContent.trim() === '»' && a.getAttribute('href')?.includes(`page=${pageNum + 1}`),
      );
      if (!hasNext) break;
      pageNum++;
      await new Promise((r) => setTimeout(r, 150));
    }
    return dropNames;
  }

  function classify(drops) {
    let isBoss = false,
      isArchi = false,
      isDominant = false;
    for (const name of drops) {
      if (!isBoss && (name.startsWith('Jeton') || BOSS_EXACT.has(name))) isBoss = true;
      if (!isArchi && ARCHI_PREFIXES.some((p) => name.startsWith(p))) isArchi = true;
      if (!isDominant && DOMINANT_EXACT.has(name)) isDominant = true;
    }
    return { isBoss, isArchi, isDominant };
  }

  // >>> Remplacer par le contenu exact d'un chunk_N.json (tableau [{id, slug}, ...]) <<<
  const CHUNK = [];

  const results = [];
  for (const { id, slug } of CHUNK) {
    const drops = await scrapeDrops(id, slug);
    results.push({ id, ...classify(drops) });
    await new Promise((r) => setTimeout(r, 150));
  }
  return results;
};
