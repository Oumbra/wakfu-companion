#!/usr/bin/env node
/**
 * Hook Git `post-commit` (voir .husky/post-commit) : incrémente automatiquement
 * la version SemVer de package.json/package-lock.json en fonction du type
 * Conventional Commits du commit qui vient d'être créé, puis AMENDE ce même
 * commit pour y inclure le bump. Remplace l'ancienne convention manuelle
 * documentée dans CLAUDE.md ("incrémenter le champ version à chaque commit
 * notable").
 *
 * Pourquoi `post-commit` + amend plutôt que `commit-msg` : `commit-msg`
 * semblait le hook naturel (il reçoit le message AVANT la création du
 * commit), mais Git construit l'arbre du commit à partir de l'index tel
 * qu'il était au moment de l'invocation de `git commit`, AVANT d'appeler
 * `commit-msg` — un `git add` fait depuis ce hook ne rentre donc PAS dans le
 * commit en cours (vérifié empiriquement : le commit se crée avec l'ancienne
 * version, le bump reste indexé mais non committé à côté). `post-commit`
 * s'exécute après coup sur un commit qui existe déjà réellement : on peut
 * l'amender pour y injecter le bump, ce qui produit bien un commit unique et
 * correct.
 *
 * Garde anti-récursion : amender un commit déclenche à nouveau `post-commit`
 * (l'amend EST un commit). La variable d'environnement
 * `WAKFU_VERSION_BUMP_AMEND=1`, positionnée uniquement sur le process `git
 * commit --amend` lancé par ce script, est propagée aux hooks de cet amend
 * et leur fait sauter tout re-bump — vérifié empiriquement (pas de boucle).
 *
 * Règle de correspondance type → niveau de bump (Conventional Commits →
 * SemVer, cf. https://www.conventionalcommits.org) :
 *   - `feat:`            → minor (x.Y.0)
 *   - `fix:`              → patch (x.y.Z)
 *   - `feat!:`/`fix!:`/… ou footer `BREAKING CHANGE:` → major (X.0.0),
 *     prioritaire sur la règle de type ci-dessus
 *   - tout autre type (docs, chore, refactor, style, test, ci, build...)
 *     ou message ne suivant pas le format Conventional Commits (ex. merge,
 *     revert) → aucun bump, sortie silencieuse.
 *
 * `npm version <niveau> --no-git-tag-version` fait le travail réel : il
 * recalcule et réécrit la version dans package.json ET package-lock.json de
 * façon cohérente (évite la dérive lockfile qui casse `npm ci` en CI — voir
 * mémoire projet "npm-version-drift-lockfile").
 *
 * Échappatoire : `SKIP_VERSION_BUMP=1 git commit ...` pour committer sans
 * bump. Un `git commit --amend` MANUEL (pas celui lancé par ce script) sur
 * un commit déjà bumpé re-déclenche ce hook et re-bump une seconde fois —
 * cas non détecté spécifiquement, utiliser l'échappatoire dans ce cas.
 */
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

if (process.env.WAKFU_VERSION_BUMP_AMEND === '1') {
  // On est dans l'amend lancé par ce script lui-même pour un bump déjà
  // appliqué plus bas dans la pile d'appel — ne pas re-bump.
  process.exit(0);
}
if (process.env.SKIP_VERSION_BUMP === '1') {
  console.log('[bump-version] SKIP_VERSION_BUMP=1 — bump ignoré.');
  process.exit(0);
}

const message = execSync('git log -1 --pretty=%B HEAD', { cwd: projectRoot }).toString();

// Ignore les lignes de commentaire (`# ...`) qu'un éditeur de message de
// commit peut injecter (statut, diff en commentaire...).
const subjectLine = message
  .split('\n')
  .find((line) => line.trim().length > 0 && !line.trim().startsWith('#'));

if (!subjectLine) {
  process.exit(0);
}

const conventionalMatch = subjectLine.match(/^(\w+)(\([\w./-]+\))?(!)?:\s+.+/);
const isBreaking = Boolean(conventionalMatch?.[3]) || /BREAKING[ -]CHANGE:/.test(message);

let bumpLevel = null;
if (isBreaking) {
  bumpLevel = 'major';
} else if (conventionalMatch) {
  const type = conventionalMatch[1].toLowerCase();
  if (type === 'feat') bumpLevel = 'minor';
  else if (type === 'fix') bumpLevel = 'patch';
}

if (!bumpLevel) {
  process.exit(0);
}

// `execSync` (commande unique en chaîne, pas `execFileSync` + tableau
// d'arguments) : sous Windows, `npm` est un shim `.cmd` que Node ne sait
// spawn qu'au travers d'un shell (sinon `ENOENT`/`EINVAL`, contrairement à
// `git` plus bas, un vrai `.exe`) — passer par une chaîne évite
// l'avertissement de dépréciation DEP0190 (spécifique à `shell: true` +
// tableau d'arguments). Sans risque d'injection ici : `bumpLevel` ne peut
// valoir que 'major'/'minor'/'patch', jamais une valeur dérivée du message
// de commit lui-même.
execSync(`npm version ${bumpLevel} --no-git-tag-version`, {
  cwd: projectRoot,
  stdio: 'inherit',
});

execFileSync('git', ['add', 'package.json', 'package-lock.json'], {
  cwd: projectRoot,
  stdio: 'inherit',
});

execFileSync('git', ['commit', '--amend', '--no-edit'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, WAKFU_VERSION_BUMP_AMEND: '1' },
});

const { version } = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
console.log(`[bump-version] ${bumpLevel} → version ${version}`);
