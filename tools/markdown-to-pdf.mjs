#!/usr/bin/env node
/**
 * Convertit un courrier rédigé en Markdown dans `docs/` en PDF A4, à côté du fichier source.
 *
 *   npm run docs:pdf -- docs/demande-autorisation-ankama-2026-09-21.md
 *   npm run docs:pdf -- docs/lettre.md --footer "Wakfu Companion — lettre" --out docs/lettre.pdf
 *
 * Écrit pour la demande d'autorisation à Ankama (`docs/demande-autorisation-ankama-*.md`), dont le
 * PDF est la pièce jointe envoyée au Support : le Markdown reste la source, le PDF se régénère
 * après chaque modification et se commite avec lui.
 *
 * Ce qui part dans le PDF : si le Markdown contient au moins deux séparateurs `---` (ligne seule),
 * **seul le texte compris entre les deux premiers** — la convention de ces brouillons : notes du
 * mainteneur au-dessus, courrier au milieu, suivi de la réponse en dessous. Sans séparateur, tout
 * le fichier. Dans le rendu, une URL ou une adresse e-mail écrite en code inline (`https://…`)
 * devient un lien cliquable, une URL de plus de 60 caractères est composée plus petit et coupée
 * n'importe où (les permaliens GitHub ne tiendraient pas dans la largeur), et les deux dernières
 * lignes d'un paragraphe de signature restent sur deux lignes.
 *
 * Moteur : `marked` pour le HTML, Chrome/Chromium via `playwright-core` pour l'impression (même
 * moteur de mise en page qu'un navigateur, polices système). Navigateur cherché dans cet ordre :
 * variable `CHROME_PATH`, Chrome installé (`channel: 'chrome'`, le cas du poste du mainteneur),
 * puis le Chromium de `PLAYWRIGHT_BROWSERS_PATH` (le cas d'une session cloud, `/opt/pw-browsers`).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { marked } from 'marked';
import { chromium } from 'playwright-core';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    footer: { type: 'string' },
    html: { type: 'string' },
  },
});

if (positionals.length !== 1) {
  console.error(
    'Usage : node tools/markdown-to-pdf.mjs <fichier.md> [--out f.pdf] [--footer texte] [--html f.html]',
  );
  process.exit(1);
}

const source = resolve(positionals[0]);
const output = resolve(values.out ?? source.replace(/\.md$/i, '') + '.pdf');
const footer = values.footer ?? defaultFooter(source);

const markdown = readFileSync(source, 'utf8').replace(/\r\n/g, '\n');
const html = renderHtml(extractLetter(markdown), footer);
if (values.html) writeFileSync(resolve(values.html), html);

const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({
    path: output,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="font-size:8pt;width:100%;text-align:center;color:#666;font-family:serif">' +
      `${escapeHtml(footer)} — page <span class="pageNumber"></span>/<span class="totalPages"></span></div>`,
  });
} finally {
  await browser.close();
}
console.log(`PDF écrit : ${output}`);

/** Le courrier seul : le texte entre les deux premiers `---`, ou tout le fichier à défaut. */
function extractLetter(md) {
  const parts = md.split(/\n---\n/);
  return (parts.length >= 3 ? parts[1] : md).trim();
}

/** « Wakfu Companion — <titre du fichier> », titre tiré du premier `# ` du Markdown. */
function defaultFooter(file) {
  const heading = readFileSync(file, 'utf8').match(/^# (.+)$/m)?.[1];
  const title = (heading ?? basename(file, '.md')).split(' — ')[0].trim();
  return `Wakfu Companion — ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
}

function renderHtml(letter, title) {
  let body = marked.parse(letter, { gfm: true });
  body = body
    .replace(/<code>(https?:\/\/[^<]+)<\/code>/g, '<a href="$1">$1</a>')
    .replace(/<code>([\w.+-]+@[\w.-]+\.\w+)<\/code>/g, '<a href="mailto:$1">$1</a>')
    .replace(/<a href="(https?:\/\/[^"]{60,})">/g, '<a class="long" href="$1">')
    // Signature : « [Nom]\n[pseudo, serveur] » en fin de courrier, deux lignes et non une.
    .replace(/(<p>[^<]*)\n([^<]*<\/p>\s*)$/, '$1<br>$2');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page { size: A4; margin: 22mm 20mm 20mm 20mm; }
body { font-family: "DejaVu Serif", Georgia, "Times New Roman", serif; font-size: 10.5pt;
  line-height: 1.45; color: #111; }
p { margin: 0 0 8pt; text-align: justify; hyphens: auto; }
body > p:first-child { text-align: left; font-size: 11.5pt; }
ol, ul { margin: 0 0 8pt; padding-left: 18pt; }
li { margin-bottom: 5pt; text-align: justify; }
li li { margin-bottom: 3pt; }
code { font-family: "DejaVu Sans Mono", Consolas, monospace; font-size: 9pt; }
a { color: #1a4fa0; text-decoration: none; }
a.long { word-break: break-all; font-size: 8.5pt; }
</style></head><body>
${body}</body></html>`;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function launchBrowser() {
  const attempts = [];
  if (process.env.CHROME_PATH) attempts.push({ executablePath: process.env.CHROME_PATH });
  attempts.push({ channel: 'chrome' });
  const bundled = bundledChromium();
  if (bundled) attempts.push({ executablePath: bundled });
  const errors = [];
  for (const options of attempts) {
    try {
      return await chromium.launch(options);
    } catch (error) {
      errors.push(`${JSON.stringify(options)} : ${error.message.split('\n')[0]}`);
    }
  }
  console.error(
    'Aucun Chrome/Chromium utilisable. Définir CHROME_PATH. Essais :\n' + errors.join('\n'),
  );
  process.exit(1);
}

/** Le Chromium le plus récent sous `PLAYWRIGHT_BROWSERS_PATH`, quelle que soit sa révision. */
function bundledChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const candidates = readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .flatMap((name) =>
      ['chrome-linux', 'chrome-linux64'].map((dir) => join(root, name, dir, 'chrome')),
    );
  return candidates.find((path) => existsSync(path));
}
