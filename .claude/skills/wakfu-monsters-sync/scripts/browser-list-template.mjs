/**
 * Template à coller tel quel dans le paramètre `function` de
 * mcp__playwright__browser_evaluate (étape 1 : liste des monstres, 4
 * locales). Passer `filename: "monsters-list-raw.json"` à browser_evaluate
 * pour écrire directement sur disque (le retour texte inonderait le contexte
 * sinon — ~540 Ko pour 851 monstres × 4 locales).
 *
 * Tenu en un seul appel browser_evaluate sans problème en session
 * (2026-08-02) : 144 requêtes (36 pages × 4 locales), aucun blocage.
 */
async () => {
  const LOCALES = {
    fr: 'https://www.wakfu.com/fr/mmorpg/encyclopedie/monstres',
    en: 'https://www.wakfu.com/en/mmorpg/encyclopedia/monsters',
    es: 'https://www.wakfu.com/es/mmorpg/enciclopedia/monstruos',
    pt: 'https://www.wakfu.com/pt/mmorpg/enciclopedia/monstros',
  };

  function parsePage(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = doc.querySelectorAll('tbody tr');
    const entries = [];
    for (const row of rows) {
      const link = row.querySelector('td:nth-child(2) a[href]');
      if (!link) continue;
      const href = link.getAttribute('href');
      const m = href.match(/(\d+)-([^/?]+)/);
      if (!m) continue;
      const id = Number(m[1]);
      const slug = m[2];
      const name = link.textContent.trim();
      const img = row.querySelector('td:nth-child(1) img');
      const gfxMatch = img?.getAttribute('src')?.match(/(\d+)\.png$/);
      const gfxId = gfxMatch ? gfxMatch[1] : null;
      const familyCell = row.querySelector('td.item-type');
      const family = familyCell?.textContent.trim() || null;
      entries.push({ id, name, family, gfxId, slug });
    }
    let totalPages = 1;
    for (const opt of doc.querySelectorAll('select.ak-select-page option')) {
      const n = Number(opt.textContent.trim());
      if (Number.isFinite(n) && n > totalPages) totalPages = n;
    }
    return { entries, totalPages };
  }

  async function scrapeLocale(baseUrl) {
    const map = {};
    const first = await fetch(`${baseUrl}?page=1`).then((r) => r.text());
    const { entries: firstEntries, totalPages } = parsePage(first);
    for (const e of firstEntries) map[e.id] = e;
    for (let p = 2; p <= totalPages; p++) {
      const html = await fetch(`${baseUrl}?page=${p}`).then((r) => r.text());
      const { entries } = parsePage(html);
      for (const e of entries) map[e.id] = e;
      await new Promise((r) => setTimeout(r, 200));
    }
    return map;
  }

  const out = {};
  for (const [lang, url] of Object.entries(LOCALES)) {
    out[lang] = await scrapeLocale(url);
  }
  return out;
};
