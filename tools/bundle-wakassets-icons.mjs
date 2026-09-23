// Copie les icônes `wakassets` en FICHIERS STATIQUES du déploiement Cloudflare Pages, sous le
// chemin même du relais (`/api/v1/icons/{folder}/{file}.png`), et exclut ce chemin des Functions
// via `_routes.json`. Lancé par les workflows de déploiement APRÈS `ng build` (voir
// .github/workflows/deploy-*.yml) : jamais par `npm run build`, pour ne pas alourdir les builds
// locaux ni faire dépendre la CI de GitHub.
//
// Pourquoi (2026-09-23) : chaque icône affichée coûtait une invocation de Function (le relais
// `functions/api/v1/icons/[folder]/[file].ts`), même servie depuis `caches.default` — le cache
// périphérique ne court-circuite pas la Function, c'est elle qui le lit. Le quota quotidien
// d'invocations du compte (Workers/Pages, offre gratuite) a été dépassé, et le projet étant en
// « Fail open », TOUTE l'API a basculé sur le statique (`index.html` pour `/api/v1/auth/me`...).
// Un fichier statique ne coûte aucune invocation et n'est pas limité en nombre de requêtes.
//
// Ce qui ne change pas : mêmes URLs pour le site (`wakassets-url.util.ts`) et l'overlay, même
// liste de dossiers et même filtre de noms que le relais (`upstreamUrl`, server/icons/proxy.ts),
// aucune requête du navigateur vers GitHub (confidentialité, constat C10 RGPD). Une icône absente
// répond 404 (`404.html` imbriqué, voir plus bas), comme le relais. Sans ce script (`wrangler pages dev` local,
// `ng serve` + serveur local), le relais dynamique reste en place : il n'est pas supprimé.
//
// Limite Pages (offre gratuite) : 20 000 fichiers par déploiement — le script échoue au-delà de
// MAX_FILES plutôt que de laisser le déploiement échouer plus loin.
//
// Usage : node tools/bundle-wakassets-icons.mjs [dossier de sortie]
//         (défaut : dist/wakfu-companion/browser)

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ALLOWED_FOLDERS, WAKASSETS_ORIGIN, upstreamUrl } from '../server/icons/proxy.ts';

const REPO_URL = 'https://github.com/Vertylo/wakassets';
const ICONS_PREFIX = 'api/v1/icons';
const MAX_FILES = 19500;

const outDir = resolve(process.argv[2] ?? 'dist/wakfu-companion/browser');
if (!existsSync(join(outDir, 'index.html'))) {
  console.error(`[wakassets] ${outDir}/index.html introuvable : lancer ng build d'abord.`);
  process.exit(1);
}
if (WAKASSETS_ORIGIN !== 'https://vertylo.github.io/wakassets') {
  console.error(
    `[wakassets] origine du relais inattendue (${WAKASSETS_ORIGIN}) : REPO_URL à revoir.`,
  );
  process.exit(1);
}

const folders = [...ALLOWED_FOLDERS];
const work = mkdtempSync(join(tmpdir(), 'wakassets-'));
const git = (...args) =>
  execFileSync('git', args, { cwd: work, stdio: ['ignore', 'pipe', 'inherit'] });

try {
  // Clone partiel : aucun blob au départ, puis uniquement ceux des dossiers relayés.
  git('clone', '--quiet', '--depth=1', '--filter=blob:none', '--no-checkout', REPO_URL, '.');
  git('sparse-checkout', 'set', '--no-cone', ...folders.map((f) => `/${f}/`));
  git('checkout', '--quiet');
  const commit = git('rev-parse', 'HEAD').toString().trim();

  let copied = 0;
  for (const folder of folders) {
    const src = join(work, folder);
    if (!existsSync(src)) {
      console.warn(`[wakassets] dossier absent de l'amont : ${folder}`);
      continue;
    }
    const dest = join(outDir, ICONS_PREFIX, folder);
    mkdirSync(dest, { recursive: true });
    for (const file of readdirSync(src)) {
      if (!upstreamUrl({ folder, file })) continue; // même filtre que le relais
      cpSync(join(src, file), join(dest, file));
      copied++;
    }
  }

  // Icône absente : Pages sert le `404.html` le plus proche avec un statut 404 (vérifié sous
  // `wrangler pages dev`) au lieu du repli SPA (`index.html`, 200) — l'overlay et les `<img>` du
  // site voient un vrai échec, comme avec le relais. Une règle `_redirects` en 404 n'est pas
  // acceptée par Pages (statuts 200/3xx seulement).
  writeFileSync(join(outDir, ICONS_PREFIX, '404.html'), 'Not Found\n');

  // `_routes.json` explicite : Wrangler n'en génère pas quand le dossier publié en contient un.
  // `exclude` l'emporte sur `include` : `/api/v1/icons/*` sort des Functions.
  writeFileSync(
    join(outDir, '_routes.json'),
    JSON.stringify({ version: 1, include: ['/api/*'], exclude: [`/${ICONS_PREFIX}/*`] }, null, 2) +
      '\n',
  );

  const total = Number(
    execFileSync('find', [outDir, '-type', 'f'], { maxBuffer: 64 * 1024 * 1024 })
      .toString()
      .split('\n')
      .filter(Boolean).length,
  );
  console.log(
    `[wakassets] ${copied} icônes copiées (commit ${commit.slice(0, 12)}), ${total} fichiers publiés.`,
  );
  if (total > MAX_FILES) {
    console.error(`[wakassets] ${total} fichiers > ${MAX_FILES} (limite Pages : 20 000).`);
    process.exit(1);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
