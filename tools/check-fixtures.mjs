#!/usr/bin/env node
/**
 * Refuse une fixture de journal (`tests/wakfu.log`, `tests/logs/** /*.log`) ou l'export de
 * référence (`tests/wakfu-companion-export.json`) qui contiendrait des données réelles.
 *
 *   node tools/check-fixtures.mjs
 *
 * Le dépôt — public — a versionné pendant six semaines un vrai `wakfu.log` (10 975 lignes :
 * jeton de session, IP locale, nom de compte Windows, personnages avec leurs identifiants,
 * 119 pseudonymes de joueurs tiers et l'intégralité de leurs messages), 36 extraits de journal
 * réels dans `tests/logs/fr/` (personnages, partenaires d'échange, auteurs de chat, liste d'amis
 * avec identifiant de compte Ankama) et un export réel du roster. Ils sont arrivés par un `git add`
 * ordinaire, et rien n'a alerté. Pseudonymisés le 2026-09-20 avec le schéma et la table de
 * l'overlay (`scripts/check-fixtures.sh` de `wakfu-companion-overlay`, mêmes pseudonymes pour le
 * même journal). Ce script est ce qui manquait : purement textuel, branché aux deux bouts — hook
 * `pre-commit` (`.husky/pre-commit`) ET étape de `.github/workflows/ci.yml`. Le hook seul ne
 * suffirait pas (absent d'un clone sans `npm install`) : c'est la CI qui fait foi.
 *
 * Ce qu'il sait voir, et rien de plus : les catégories réellement trouvées dans ces fichiers.
 * Quand une catégorie nouvelle apparaît dans un journal, elle s'ajoute ici, pas ailleurs.
 *
 * Depuis le 2026-09-21 (`docs/analyse-rgpd.md` 4.15), une SECONDE passe applique les règles qui
 * ne dépendent d'aucun format de fixture (jeton, chemin Windows, IP privée, compte Ankama, ligne
 * compte Ankama) à tout le CODE versionné — `src/`, `server/`, `functions/`, `tools/` et le
 * reste de `tests/`. C'est par là que les données réelles étaient revenues la première fois :
 * trois fichiers de specs (`log-parser.spec.ts`, `stats-store.service.spec.ts`,
 * `server/history/parse.spec.ts`) recopiaient des noms et des messages du journal réel, sans
 * qu'aucune fixture soit en cause. Les noms de joueurs et les messages, eux, restent indétectables
 * par motif dans du code : une spec invente légitimement « Bob » ou « Alice », qu'aucune règle ne
 * distingue d'un pseudonyme réel. Ce garde-fou attrape ce qui a une forme, jamais tout.
 *
 * Schéma attendu :
 *   - jeton de session       → 00000000-0000-0000-0000-000000000000
 *   - C:\Users\<nom>         → anonymous
 *   - IP privée              → 192.0.2.0/24 (plage de documentation, RFC 5737)
 *   - personnage du compte   → Anonyme-<Classe><N>, id 9000000N (ex. Anonyme-Sram1 [90000007])
 *   - autre joueur           → Anonyme-Joueur<N> / Anonyme-NNN, id 90001NNN, message en lorem ipsum
 *   - compte Ankama (x#NNNN) → anonymeNN#NNNN
 * Le pseudonyme du mainteneur est traité comme les autres : il n'apparaît dans aucune fixture.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const logFixtures = [
  path.join(projectRoot, 'tests', 'wakfu.log'),
  ...walk(path.join(projectRoot, 'tests', 'logs')).filter((f) => f.endsWith('.log')),
];
const exportFixture = path.join(projectRoot, 'tests', 'wakfu-companion-export.json');

let failures = 0;
function report(file, count, what, expected) {
  console.error(
    `\x1b[31m✗ ${path.relative(projectRoot, file)} : ${count} ${what}\x1b[0m\n  ${expected}`,
  );
  failures += 1;
}

/** Lignes qui matchent `pattern` mais pas `allowed` (une ligne = un enregistrement, comme grep). */
function offending(lines, pattern, allowed) {
  return lines.filter((line) => pattern.test(line) && !allowed.test(line));
}

const CHANNELS =
  'Proximité|Guilde|Commerce|Groupe|Équipe|Recrutement[^\\]]*|Communauté[^\\]]*|Privé[^\\]]*';
const PSEUDO = 'Anonyme-[A-Za-zÀ-ÿ]+[0-9]+';

for (const file of logFixtures) {
  const lines = readFileSync(file, 'utf-8').split('\n');
  let n;

  // 1. Jeton de session du client de jeu : le seul secret qu'un wakfu.log contienne.
  n = offending(
    lines,
    /Authentication token received from dispatch server : [0-9a-fA-F-]{36}/,
    /: 0{8}-0{4}-0{4}-0{4}-0{12}/,
  ).length;
  if (n)
    report(
      file,
      n,
      "jeton(s) d'authentification",
      'attendu « 00000000-0000-0000-0000-000000000000 »',
    );

  // 2. Nom de compte Windows : le chemin du journal le porte à chaque texture chargée.
  n = lines
    .flatMap((l) => l.match(/C:[\\/]Users[\\/][^\\/ ]+/g) ?? [])
    .filter((m) => !m.endsWith('anonymous')).length;
  if (n) report(file, n, 'chemin(s) C:\\Users\\<nom>', 'attendu « anonymous »');

  // 3. Adresse IP privée.
  n = offending(
    lines,
    /(^|[^0-9.])(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)[0-9]{1,3}\.[0-9]{1,3}/,
    /$^/,
  ).length;
  if (n) report(file, n, 'ligne(s) avec une IP privée', 'attendu une adresse 192.0.2.x (RFC 5737)');

  // 4. Auteur de chat non pseudonymisé (canaux publics et privés, un pseudonyme de tiers par ligne).
  n = offending(
    lines,
    new RegExp(`\\) - \\[(${CHANNELS})\\] [^:]+ : `),
    new RegExp(`\\] (Anonyme-[0-9]{3}|${PSEUDO}) : `),
  ).length;
  if (n)
    report(
      file,
      n,
      'message(s) de chat à auteur réel',
      'attendu « Anonyme-NNN » — et un contenu généré, jamais recopié',
    );

  // 5. Combattant humain (`isControlledByAI=false`) non pseudonymisé, avec son identifiant.
  n = offending(
    lines,
    /\[_FL_\] fightId=[0-9]+ [^[]+ breed : [0-9]+ \[-?[0-9]+\] isControlledByAI=false/,
    new RegExp(` ${PSEUDO} breed : [0-9]+ \\[9[0-9]{7}\\] `),
  ).length;
  if (n)
    report(
      file,
      n,
      "entrée(s) en combat d'un joueur réel",
      'attendu « Anonyme-<Classe><N> breed : B [9000000N] »',
    );

  // 6. Identifiant de compte Ankama (liste d'amis) : la donnée la plus identifiante du fichier.
  n = lines
    .flatMap((l) => l.match(/\([A-Za-z0-9_.-]+#[0-9]{4}\)/g) ?? [])
    .filter((m) => !/^\(anonyme[0-9]{2}#[0-9]{4}\)$/.test(m)).length;
  if (n) report(file, n, 'identifiant(s) de compte Ankama', 'attendu « anonymeNN#NNNN »');

  // 7. Échange entre deux joueurs : deux noms et deux identifiants sur une ligne, puis « le joueur X ».
  n = offending(
    lines,
    /\[Trade\] (Starting|Ending) (an|the) exchange between /,
    new RegExp(`between ${PSEUDO} \\(id=9[0-9]{7}\\) and ${PSEUDO} \\(id=9[0-9]{7}\\)`),
  ).length;
  if (n)
    report(
      file,
      n,
      "ligne(s) d'échange à joueur réel",
      'attendu « Anonyme-… (id=9…) » des deux côtés',
    );
  n = offending(
    lines,
    /\[Trade\] [Ll]e joueur [^ ]/,
    new RegExp(`\\[Trade\\] [Ll]e joueur ${PSEUDO} `),
  ).length;
  if (n) report(file, n, "ligne(s) d'échange à joueur réel", 'attendu « Le joueur Anonyme-… »');
}

// 8. Export de référence : pseudo du profil et noms de personnages du roster.
{
  const data = JSON.parse(readFileSync(exportFixture, 'utf-8')).data ?? {};
  const names = [
    data.profile?.pseudo,
    ...(data.roster ?? []).flatMap((a) => a.characters.map((c) => c.name)),
  ].filter(Boolean);
  const bad = names.filter((n) => !new RegExp(`^${PSEUDO}$`).test(n));
  if (bad.length)
    report(
      exportFixture,
      bad.length,
      'nom(s) de personnage réel(s) (profil ou roster)',
      'attendu « Anonyme-<Classe><N> »',
    );
}

// ── Seconde passe : le code versionné ───────────────────────────────────────────────────────────
// Mêmes règles, appliquées au texte brut de chaque fichier suivi par git (hors fixtures, déjà
// passées ci-dessus, et hors ce fichier, qui décrit les motifs qu'il refuse).
const SOURCE_DIRS = ['src', 'server', 'functions', 'tools', 'tests'];
const SOURCE_EXTENSIONS = ['.ts', '.js', '.mjs', '.html', '.css', '.json', '.md'];
const fixtureSet = new Set([
  ...logFixtures,
  exportFixture,
  path.join(projectRoot, 'tools', 'check-fixtures.mjs'),
]);

const sourceFiles = SOURCE_DIRS.flatMap((dir) => walk(path.join(projectRoot, dir))).filter(
  (file) => SOURCE_EXTENSIONS.includes(path.extname(file)) && !fixtureSet.has(file),
);

for (const file of sourceFiles) {
  const lines = readFileSync(file, 'utf-8').split('\n');
  let n;

  n = offending(
    lines,
    /Authentication token received from dispatch server : [0-9a-fA-F-]{36}/,
    /: 0{8}-0{4}-0{4}-0{4}-0{12}/,
  ).length;
  if (n) report(file, n, "jeton(s) d'authentification recopié(s)", 'attendu « 0000…0000 »');

  n = lines
    .flatMap((l) => l.match(/C:[\\/]{1,2}Users[\\/]{1,2}[^\\/ '"]+/g) ?? [])
    .filter((m) => !m.endsWith('anonymous')).length;
  if (n) report(file, n, 'chemin(s) C:\\Users\\<nom>', 'attendu « anonymous »');

  n = offending(
    lines,
    /(^|[^0-9.])(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)[0-9]{1,3}\.[0-9]{1,3}/,
    /$^/,
  ).length;
  if (n) report(file, n, 'ligne(s) avec une IP privée', 'attendu une adresse 192.0.2.x (RFC 5737)');

  n = lines
    .flatMap((l) => l.match(/\([A-Za-z0-9_.-]+#[0-9]{4}\)/g) ?? [])
    .filter((m) => !/^\(anonyme[0-9]{2}#[0-9]{4}\)$/.test(m)).length;
  if (n) report(file, n, 'identifiant(s) de compte Ankama', 'attendu « anonymeNN#NNNN »');

  // Pas de règle « auteur de chat » ici, contrairement aux fixtures : une spec construit
  // légitimement ses propres lignes de chat avec des noms inventés (« Bob », « Alice »), qu'aucun
  // motif ne distingue d'un pseudonyme réel. Ce qui est vérifiable l'est ci-dessus ; le reste
  // reste une question à se poser en écrivant la spec (voir docs/analyse-rgpd.md 4.11).
}

if (failures) {
  console.error(`
╭──────────────────────────────────────────────────────────────────────╮
│ Des données réelles dans une fixture ou dans le code.                │
│                                                                      │
│ Le dépôt est PUBLIC : un journal brut y publie un jeton de session,  │
│ une IP, un nom de compte Windows et les pseudonymes et messages de   │
│ tous les joueurs croisés ce jour-là.                                 │
│                                                                      │
│ Pseudonymiser avant de committer — voir l'en-tête de                 │
│ tools/check-fixtures.mjs (schéma) et docs/analyse-rgpd.md.           │
╰──────────────────────────────────────────────────────────────────────╯`);
  process.exit(1);
}
console.log(
  `Fixtures (${logFixtures.length} journaux + export) et ${sourceFiles.length} fichiers de code : aucune donnée réelle.`,
);
