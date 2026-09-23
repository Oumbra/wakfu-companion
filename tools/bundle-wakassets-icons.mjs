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
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  openSync,
  readSync,
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
// Commit amont ÉPINGLÉ (audit du 2026-09-23, S3) : le contenu du dépôt tiers est publié tel quel
// sur notre domaine ; un commit malveillant (ou un compte compromis) ne doit pas partir en
// production au déploiement suivant sans relecture. Pour prendre de nouvelles icônes :
// `git ls-remote https://github.com/Vertylo/wakassets HEAD`, relire le diff amont, reporter le SHA.
const WAKASSETS_COMMIT = '9159bb11d31c08c987059328f4a50cef7c1f1af7';
// Une icône pèse quelques Ko : au-delà, ce n'est pas une icône.
const MAX_ICON_BYTES = 512 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Vrai pour un fichier ordinaire (jamais un lien symbolique) de taille bornée, signé PNG. */
function isPlainPng(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > MAX_ICON_BYTES || stat.size < PNG_SIGNATURE.length) {
    return false;
  }
  const head = Buffer.alloc(PNG_SIGNATURE.length);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, head, 0, head.length, 0);
  } finally {
    closeSync(fd);
  }
  return head.equals(PNG_SIGNATURE);
}
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
  // Clone partiel du commit épinglé : aucun blob au départ, puis uniquement ceux des dossiers
  // relayés. `core.symlinks=false` : un lien symbolique de l'amont devient un fichier texte
  // (écarté ensuite par `isPlainPng`), jamais un lien vers un fichier du runner.
  git('init', '--quiet');
  git('config', 'core.symlinks', 'false');
  git('remote', 'add', 'origin', REPO_URL);
  git('sparse-checkout', 'set', '--no-cone', ...folders.map((f) => `/${f}/`));
  git('fetch', '--quiet', '--depth=1', '--filter=blob:none', 'origin', WAKASSETS_COMMIT);
  git('checkout', '--quiet', 'FETCH_HEAD');
  const commit = git('rev-parse', 'HEAD').toString().trim();
  if (commit !== WAKASSETS_COMMIT) {
    throw new Error(`commit inattendu ${commit}, attendu ${WAKASSETS_COMMIT}`);
  }

  let copied = 0;
  let rejected = 0;
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
      if (!isPlainPng(join(src, file))) {
        rejected++;
        continue;
      }
      copyFileSync(join(src, file), join(dest, file));
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
    `[wakassets] ${copied} icônes copiées, ${rejected} écartées (pas un PNG ordinaire), ` +
      `commit ${commit.slice(0, 12)}, ${total} fichiers publiés.`,
  );
  if (total > MAX_FILES) {
    console.error(`[wakassets] ${total} fichiers > ${MAX_FILES} (limite Pages : 20 000).`);
    process.exit(1);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
