#!/usr/bin/env node
/**
 * Hook Git `pre-commit` (voir .husky/pre-commit) : reformate automatiquement
 * avec Prettier les fichiers STAGÉS qui entrent dans le périmètre vérifié par
 * la CI (`npx prettier --check`, glob src/, server/, functions/ — voir la
 * commande complète dans .github/workflows/ci.yml), puis les re-stage.
 *
 * Motivation : un commit contenant un fichier non conforme à Prettier fait
 * échouer la CI dès l'étape "Check formatting", sans qu'aucun garde-fou
 * local ne l'empêche en amont — cas réel vécu le 2026-08-15 (commit
 * 59c5a5f, jamais corrigé sur le coup, la liste de fichiers en infraction
 * s'est allongée commit après commit jusqu'à casser 25+ runs consécutifs
 * avant d'être détecté et corrigé le 2026-08-17). Ce hook applique
 * directement `--write` (plutôt qu'un `--check` bloquant) pour rester
 * silencieux dans le cas courant : le commit part déjà formaté, sans étape
 * manuelle à se souvenir de lancer.
 *
 * Périmètre volontairement dupliqué depuis ci.yml plutôt que lu dynamiquement
 * (pas de dépendance YAML) — si le glob de la CI change, mettre à jour
 * `matchesPrettierScope` ici en même temps.
 *
 * Échappatoire : `SKIP_PRECOMMIT_FORMAT=1 git commit ...` (même convention
 * que `SKIP_VERSION_BUMP`, voir tools/bump-version-from-commit.mjs).
 */
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

if (process.env.SKIP_PRECOMMIT_FORMAT === '1') {
  console.log('[pre-commit-format] SKIP_PRECOMMIT_FORMAT=1 — formatage ignoré.');
  process.exit(0);
}

function matchesPrettierScope(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.startsWith('src/') && /\.(ts|html|css)$/.test(normalized)) return true;
  if (normalized.startsWith('server/') && normalized.endsWith('.ts')) return true;
  if (normalized.startsWith('functions/') && normalized.endsWith('.ts')) return true;
  return false;
}

// `--diff-filter=ACMR` : fichiers ajoutés/copiés/modifiés/renommés (existent
// forcément sur disque) — exclut les suppressions, qu'il n'y a rien à
// reformater.
const stagedFiles = execSync('git diff --cached --name-only --diff-filter=ACMR', {
  cwd: projectRoot,
})
  .toString()
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .filter(matchesPrettierScope);

if (stagedFiles.length === 0) {
  process.exit(0);
}

console.log(`[pre-commit-format] Formatage de ${stagedFiles.length} fichier(s) stagé(s)...`);

// `execSync` en chaîne (pas `execFileSync` + tableau) : sous Windows, `npx`
// est un shim `.cmd` que Node ne sait spawn qu'au travers d'un shell — même
// raison que pour `npm version` dans bump-version-from-commit.mjs.
const quotedFiles = stagedFiles.map((f) => `"${f}"`).join(' ');
execSync(`npx prettier --write ${quotedFiles}`, {
  cwd: projectRoot,
  stdio: 'inherit',
});

execFileSync('git', ['add', ...stagedFiles], {
  cwd: projectRoot,
  stdio: 'inherit',
});

console.log('[pre-commit-format] OK.');
