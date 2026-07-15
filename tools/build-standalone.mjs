#!/usr/bin/env node
/**
 * Inline le JS, le CSS et le favicon produits par `ng build` directement dans
 * index.html, pour obtenir un unique fichier HTML ouvrable en `file://` sans
 * serveur (comme demandé par le brief : "produire un fichier HTML standalone").
 *
 * L'application n'a ni routing ni lazy-loading, donc le build ne produit
 * normalement qu'un seul chunk JS (main.js) + un seul styles.css. Ce script
 * reste générique : il inline tout <script src> / <link rel="stylesheet">
 * local trouvé dans index.html, et échoue avec un message clair si un
 * fichier référencé est introuvable (pour repérer un futur build multi-chunk).
 */
import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(projectRoot, 'dist', 'wakfu-companion', 'browser');
const outputFile = path.join(projectRoot, 'wakfu-companion.standalone.html');

function extToMime(ext) {
  return { '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml' }[ext] ?? 'application/octet-stream';
}

async function readDistFile(relativeHref) {
  const filePath = path.join(distDir, relativeHref);
  if (!existsSync(filePath)) {
    throw new Error(
      `Fichier référencé dans index.html introuvable : ${relativeHref} (attendu dans ${distDir}). ` +
        `Le build a peut-être produit un chunk supplémentaire (lazy-loading ?) — vérifiez dist/wakfu-companion/browser.`,
    );
  }
  return filePath;
}

async function main() {
  const indexPath = path.join(distDir, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`${indexPath} introuvable. Lancez d'abord "npm run build:standalone:compile".`);
  }
  let html = await readFile(indexPath, 'utf8');

  // Inline les feuilles de style locales.
  html = await replaceAllAsync(html, /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, async (match, href) => {
    if (/^(https?:)?\/\//.test(href)) return match;
    const filePath = await readDistFile(href);
    const css = await readFile(filePath, 'utf8');
    console.log(`  inline CSS  : ${href} (${css.length} octets)`);
    return `<style>${css}</style>`;
  });

  // Inline les scripts locaux (en conservant leurs attributs, ex. type="module").
  html = await replaceAllAsync(
    html,
    /<script([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/g,
    async (match, before, src, after) => {
      if (/^(https?:)?\/\//.test(src)) return match;
      const filePath = await readDistFile(src);
      const js = await readFile(filePath, 'utf8');
      console.log(`  inline JS   : ${src} (${js.length} octets)`);
      return `<script${before}${after}>${js}</script>`;
    },
  );

  // Inline la favicon en data URI.
  html = await replaceAllAsync(html, /<link([^>]*)rel="icon"([^>]*)href="([^"]+)"([^>]*)>/g, async (match, a, b, href, c) => {
    if (/^(https?:|data:)/.test(href)) return match;
    const filePath = await readDistFile(href);
    const bytes = await readFile(filePath);
    const mime = extToMime(path.extname(href));
    console.log(`  inline icon : ${href} (${bytes.length} octets)`);
    return `<link${a}rel="icon"${b}href="data:${mime};base64,${bytes.toString('base64')}"${c}>`;
  });

  await writeFile(outputFile, html, 'utf8');
  const { size } = await stat(outputFile);
  console.log(`\nFichier standalone généré : ${outputFile} (${(size / 1024).toFixed(1)} Ko)`);
}

async function replaceAllAsync(input, pattern, replacer) {
  const matches = [...input.matchAll(pattern)];
  let result = input;
  for (const match of matches) {
    const replacement = await replacer(...match);
    // Le remplaçant (JS/CSS minifié) peut contenir des séquences "$&", "$'", etc.
    // Passer une fonction évite que String.replace ne les interprète comme des
    // motifs spéciaux (ce qui dupliquerait des morceaux du HTML environnant).
    result = result.replace(match[0], () => replacement);
  }
  return result;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
