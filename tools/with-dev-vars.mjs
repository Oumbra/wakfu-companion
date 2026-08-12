#!/usr/bin/env node
// Charge les variables du fichier `.dev.vars` (format dotenv KEY=valeur, une
// par ligne, convention wrangler standard) dans l'environnement, puis lance
// la commande passée en argument comme process enfant.
//
// Remplace un enchaînement `DATABASE_URL="$(jq -r .DATABASE_URL .dev.vars)" npm run ...`
// qui ne fonctionne ni sous Windows (npm exécute les scripts via cmd.exe, qui
// ne comprend ni `VAR=valeur commande` ni `$(...)`), ni sous Bash (`.dev.vars`
// n'est pas du JSON, `jq` échoue dessus).
//
// Usage : node tools/with-dev-vars.mjs <commande> [args...]
//   ex.  node tools/with-dev-vars.mjs npm run catalog:import

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEV_VARS_PATH = resolve(process.cwd(), '.dev.vars');

function parseDevVars(path) {
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    console.error(`[with-dev-vars] Fichier introuvable : ${path}`);
    process.exit(1);
  }

  const vars = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('[with-dev-vars] Usage : node tools/with-dev-vars.mjs <commande> [args...]');
  process.exit(1);
}

const devVars = parseDevVars(DEV_VARS_PATH);

const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...devVars, ...process.env },
});

if (result.error) {
  console.error(`[with-dev-vars] Échec du lancement de "${command}" :`, result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
