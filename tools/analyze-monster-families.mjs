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
 * Pour chaque monstre orphelin, cherche un AUTRE monstre ayant, lui, une famille assignée, et
 * classe les correspondances trouvées par confiance décroissante (constatée le 2026-08-16 sur le
 * jeu de données réel) :
 *   A. Même `gfxId` ET même nom (n'importe quelle langue) — quasi toujours la même entité dupliquée
 *      sous deux `id` différents dans le référentiel (5 cas stricts, ex. "Corbic"/"Corbac"...),
 *      parfois avec un simple suffixe numéroté ("Moogrr 1/2/3" -> "Moogrr", même gfxId, nom
 *      différent mais famille du même "Moogrr" retenue via CE critère précis — voir tri ci-dessous,
 *      le nom seul aurait raté ces 3 cas faute d'homonymie EXACTE).
 *   B. Même NOM seul (gfxId différent) — un même nom affiché peut recouvrir plusieurs variantes
 *      visuelles/paliers distincts dans les données Ankama, mais rester la même "espèce" du point
 *      de vue bestiaire/famille.
 *   C. Même `gfxId` seul (nom différent) — le plus faible des trois : Ankama réutilise parfois un
 *      même sprite pour des monstres sans rapport (constaté : `gfxId` 120501758 partagé par
 *      "Malocac" ET "Riktus Elite Dominant", familles 45 et 8 — une pure coïncidence graphique, pas
 *      un indice de famille commune). Cette catégorie n'est utilisée QUE si aucun candidat A/B
 *      n'existe pour l'orphelin (sinon elle ne fait qu'ajouter du bruit, voir "Malocac" : le
 *      candidat B, famille 45, est le bon — le candidat C, famille 8, est écarté).
 *
 * Signale aussi, séparément, les orphelins qui partagent leur `gfxId` OU leur nom avec un ou
 * plusieurs AUTRES orphelins (aucun des deux n'a de famille, donc pas de candidat de correction par
 * les règles ci-dessus) — un indice qu'ils forment un groupe cohérent (constaté : les 4 "Mimic
 * ..." et les 4 "Mercenaire de ..." partagent chacun un `gfxId` entre eux) qui gagnerait à recevoir
 * une VRAIE famille commune plutôt que de dépendre du repli par nom de
 * resolveFightTypeClassification (qui, lui, ne fusionne que les homonymes EXACTS : les 4 "Mimic
 * ..." resteront 4 groupes distincts tant qu'aucune famille ne leur est assignée).
 *
 * Usage :
 *   node tools/analyze-monster-families.mjs [baseUrl]
 * `baseUrl` (déf. la preview de la branche claude/dev) doit exposer /api/v1/catalog/ et
 * /api/v1/dungeons (voir server/README.md) — AUCUNE donnée de catalogue n'est committée dans ce
 * dépôt (`/repository` est gitignored, régénéré très rarement à la main, voir CLAUDE.md), la seule
 * source de vérité accessible depuis un poste de dev est donc l'API déployée (ou une base Neon
 * locale, voir .dev.vars/.env).
 */
// Bug corrigé (2026-08-16) : le préfixe `/api/v1` (voir core/api/api-client.service.ts, `baseUrl`)
// manquait — `/catalog/` tout seul tombe sur une route Angular inexistante, servie par le
// catch-all SPA (`public/_redirects` : `/* /index.html 200`) qui répond 200 avec le HTML de la
// coquille de l'app plutôt qu'un 404, d'où le `Unexpected token '<'` au `JSON.parse` (réponse
// HTML, pas JSON).
//
// 2e bug corrigé (2026-08-16, même symptôme, cause différente) : `https://wakfu-companion.pages.dev`
// (SANS préfixe de branche) n'est PAS la preview claude/dev malgré ce que documente CLAUDE.md
// (section référencement — un domaine y sert volontairement de cible SEO stable, PAS forcément la
// dernière preview déployée) : il répond 200 sur `/api/v1/catalog/` mais avec des données PÉRIMÉES
// (`importedAt` figé sur un import du 2026-08-13, alors qu'un nouvel import venait d'être fait —
// confirmé en interrogeant directement Postgres via `.dev.vars`, qui montrait, lui, les bonnes
// valeurs). Vraie URL de preview de branche : `https://claude-dev.wakfu-companion.pages.dev` (voir
// mémoire `cloudflare-pages-preview.md` — alias par branche sur le même projet Cloudflare Pages,
// `<branche-slug>.wakfu-companion.pages.dev`).
const baseUrl = (
  process.argv[2] ?? 'https://claude-dev.wakfu-companion.pages.dev'
).replace(/\/$/, '');
const API_PREFIX = '/api/v1';

async function getJson(path) {
  const url = `${baseUrl}${API_PREFIX}${path}`;
  const res = await fetch(url);
  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok || !contentType.includes('application/json')) {
    const body = await res.text();
    throw new Error(
      `${url} -> HTTP ${res.status} (content-type: ${contentType || 'inconnu'})\n${body.slice(0, 300)}`,
    );
  }
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

function normalizedNames(monster) {
  return new Set(['fr', 'en', 'es', 'pt'].map((locale) => normalize(monster[locale])));
}

function sharesName(a, b) {
  const namesA = normalizedNames(a);
  for (const name of normalizedNames(b)) if (namesA.has(name)) return true;
  return false;
}

function describe(m) {
  return `#${m.id} "${m.fr}" (gfxId ${m.gfxId}${m.family !== undefined ? `, famille ${m.family}` : ''})`;
}

// Enveloppé dans main() + process.exit() explicite (plutôt qu'un top-level await qui laisserait
// Node gérer lui-même la sortie sur rejet) : évite de dépendre du chemin de sortie par défaut de
// Node en cas d'erreur réseau, qui a déclenché un crash `UV_HANDLE_CLOSING` (bug Node/libuv sous
// Windows sans rapport avec ce script) au lieu d'un simple message d'erreur lisible.
async function main() {
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

  const familyByGfxId = new Map();
  for (const m of withFamily) {
    if (!familyByGfxId.has(m.gfxId)) familyByGfxId.set(m.gfxId, []);
    familyByGfxId.get(m.gfxId).push(m);
  }

  console.log(`Total monstres : ${monsters.length}`);
  console.log(`Sans famille   : ${withoutFamily.length}`);
  console.log(`  dont boss de donjon (déjà groupés par donjon, sans impact) : ${orphanBosses.length}`);
  console.log(`  dont "orphelins" pertinents pour le palier "famille"       : ${orphans.length}`);
  console.log('');

  // Pour chaque orphelin, classe tous les monstres-AVEC-famille candidats en 3 paliers (A/B/C, voir
  // doc de tête) et ne retient que le meilleur palier non vide — un candidat C n'est montré que si
  // aucun A/B n'existe pour cet orphelin précis.
  const tierACandidates = [];
  const tierBCandidates = [];
  const tierCCandidates = [];
  const noCandidates = [];
  for (const orphan of orphans) {
    const gfxMatches = familyByGfxId.get(orphan.gfxId) ?? [];
    const tierA = gfxMatches.filter((m) => sharesName(orphan, m));
    const tierC = gfxMatches.filter((m) => !sharesName(orphan, m));
    const tierB = withFamily.filter(
      (m) => m.gfxId !== orphan.gfxId && sharesName(orphan, m),
    );
    if (tierA.length > 0) tierACandidates.push({ orphan, matches: tierA });
    else if (tierB.length > 0) tierBCandidates.push({ orphan, matches: tierB });
    else if (tierC.length > 0) tierCCandidates.push({ orphan, matches: tierC });
    else noCandidates.push(orphan);
  }

  function logCandidate({ orphan, matches }) {
    const suggestion = [...new Set(matches.map((m) => m.family))];
    console.log(
      `  ${describe(orphan)} -> ${matches.map(describe).join(', ')}` +
        (suggestion.length === 1
          ? ` => famille suggérée : ${suggestion[0]}`
          : ' => familles divergentes au sein même de ce palier, à trancher manuellement'),
    );
  }

  console.log(`Palier A — même gfxId ET même nom (${tierACandidates.length}) :`);
  tierACandidates.forEach(logCandidate);

  console.log('');
  console.log(`Palier B — même nom seul, gfxId différent (${tierBCandidates.length}) :`);
  tierBCandidates.forEach(logCandidate);

  console.log('');
  console.log(`Palier C — même gfxId seul, nom différent (repli le plus faible, ${tierCCandidates.length}) :`);
  tierCCandidates.forEach(logCandidate);

  console.log('');
  console.log(`Orphelins SANS aucun candidat (${noCandidates.length}) :`);
  for (const orphan of noCandidates) console.log(`  ${describe(orphan)}`);

  // Clusters d'orphelins SANS AUCUN candidat (voir noCandidates ci-dessus) qui partagent gfxId ou
  // nom ENTRE EUX — voir doc de tête ("Mimic ...", "Mercenaire de ..."). Restreint à noCandidates
  // (pas à tous les orphelins) : un orphelin déjà résolu par un palier A/B/C n'a pas besoin d'être
  // re-signalé ici (ex. "Moogrr 1/2/3", déjà couverts par le palier C ci-dessus).
  const seen = new Set();
  const clusters = [];
  for (const orphan of noCandidates) {
    if (seen.has(orphan.id)) continue;
    const cluster = noCandidates.filter(
      (other) => other.id === orphan.id || other.gfxId === orphan.gfxId || sharesName(orphan, other),
    );
    if (cluster.length > 1) {
      for (const m of cluster) seen.add(m.id);
      clusters.push(cluster);
    }
  }
  if (clusters.length > 0) {
    console.log('');
    console.log(`Clusters d'orphelins liés ENTRE EUX (même gfxId ou même nom, sans famille connue, ${clusters.length} groupe(s)) :`);
    for (const cluster of clusters) {
      console.log(`  ${cluster.map(describe).join(', ')}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`[analyze-monster-families] ${error.message}`);
    process.exit(1);
  });
