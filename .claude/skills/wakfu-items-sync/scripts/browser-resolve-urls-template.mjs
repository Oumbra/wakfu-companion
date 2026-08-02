/**
 * Template à coller tel quel dans le paramètre `function` de
 * mcp__playwright__browser_evaluate, pour résoudre une liste d'URLs
 * d'encyclopédie FR déjà confirmées (recherche Google filtrée, ou URLs
 * explicites fournies directement par l'utilisateur) en entrées complètes
 * (id, gfxId, rareté, noms fr/en/es/pt) — voir SKILL.md, section "Objets
 * introuvables par scraping systématique (captures d'écran, recherche
 * ciblée)".
 *
 * Nécessaire ici comme pour wakfu-monsters-sync : `WebFetch` (l'outil
 * standard) reçoit un 403 du WAF wakfu.com (vérifié en session, 2026-08-02),
 * alors que `fetch()` exécuté dans le contexte JS d'une vraie page
 * (browser_evaluate) n'a jamais été bloqué. Faire un `browser_navigate` vers
 * n'importe quelle page wakfu.com AVANT le premier appel de ce template pour
 * établir la session.
 *
 * Remplacer uniquement le contenu de CANDIDATES par les entrées confirmées
 * (clé arbitraire -> URL de la fiche FR). Passer `filename:
 * "resolved-urls.json"` à browser_evaluate pour écrire le résultat sur
 * disque plutôt que de l'inonder dans le contexte de conversation si la
 * liste est longue.
 */
async () => {
  // >>> Remplacer par les URLs confirmées (voir procédure dans SKILL.md) <<<
  const CANDIDATES = [
    { key: 'exemple', url: 'https://www.wakfu.com/fr/mmorpg/encyclopedie/divers/27951-havre-ambiance-etoiles' },
  ];

  function extractH1(html) {
    const m = html.match(/<h1 class="ak-return-link">([\s\S]*?)<\/h1>/);
    if (!m) return null;
    return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
  }
  function extractHreflang(html) {
    const out = {};
    const re = /<link rel="alternate" href="([^"]+)" hreflang="(en|es|pt)"\s*\/?>/g;
    let m;
    while ((m = re.exec(html))) out[m[2]] = m[1];
    return out;
  }
  function extractRarity(html) {
    const m = html.match(/ak-icon-small ak-rarity-(\d+)"(?:\s+title="([^"]*)")?\s*><\/span>/);
    if (!m) return { num: null, title: null };
    return { num: Number(m[1]), title: m[2] || null };
  }
  function extractGfx(html) {
    const m = html.match(/\/item\/\d+\/(\d+)\.(?:w40h40\.)?png/);
    return m ? m[1] : null;
  }
  function extractId(url) {
    const m = url.match(/\/(\d+)(?:-[^/?]+)?(?:\?|$)/);
    return m ? Number(m[1]) : null;
  }

  const out = {};
  for (const { key, url } of CANDIDATES) {
    const res = await fetch(url);
    if (res.status !== 200) {
      out[key] = { error: `status ${res.status}`, url };
      continue;
    }
    const html = await res.text();
    const fr = extractH1(html) || (html.match(/<title>([^<]+)<\/title>/) || [])[1]?.split(' - ')[0]?.trim();
    const hreflang = extractHreflang(html);
    const rarity = extractRarity(html);
    const gfxId = extractGfx(html);
    const id = extractId(url);

    const names = { fr, en: fr, es: fr, pt: fr };
    for (const lang of ['en', 'es', 'pt']) {
      const lurl = hreflang[lang];
      if (!lurl) continue;
      const lres = await fetch(lurl);
      if (lres.status !== 200) continue;
      const lhtml = await lres.text();
      const lname = extractH1(lhtml) || (lhtml.match(/<title>([^<]+)<\/title>/) || [])[1]?.split(' - ')[0]?.trim();
      if (lname) names[lang] = lname;
    }
    out[key] = { id, gfxId, rarityNum: rarity.num, rarityTitle: rarity.title, ...names };
  }
  return out;
};
