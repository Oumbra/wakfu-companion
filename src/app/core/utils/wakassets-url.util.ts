/**
 * URLs des images `wakassets` (dépôt communautaire `vertylo.github.io/wakassets`) — TOUJOURS
 * servies par notre relais `GET /api/v1/icons/{folder}/{file}` (voir `server/icons/proxy.ts`),
 * jamais chargées directement depuis GitHub Pages par le navigateur (2026-09-20 : GitHub ne voit
 * plus l'adresse IP ni la liste des icônes demandées par un visiteur du site — même raison que
 * pour l'overlay de bureau, constat C10 RGPD ; et `img-src` de la CSP n'autorise plus cette
 * origine, voir `public/_headers`).
 *
 * Deux points d'entrée, à utiliser partout à la place d'une URL en dur :
 * - `wakassetsIconUrl(folder, file)` pour une image dont on connaît le dossier et le nom ;
 * - `proxyWakassetsUrl(url)` pour une URL reçue toute faite (les `pictureUrl` de l'API catalogue,
 *   stockées en base telles que fournies par le référentiel).
 *
 * Tout nouveau dossier utilisé ici doit aussi être ajouté à `ALLOWED_FOLDERS` côté serveur, sinon
 * le relais répond 400 et l'image ne s'affiche jamais.
 */

/** Origine amont, à ne matcher que dans `proxyWakassetsUrl` — miroir de `WAKASSETS_ORIGIN`
 * (`server/icons/proxy.ts`, `server/` ne dépend jamais de `src/`). */
const WAKASSETS_ORIGIN = 'https://vertylo.github.io/wakassets';

/** Préfixe du relais — chemin relatif, valable sous `ng serve` (proxy.conf.json) comme en prod. */
export const WAKASSETS_PROXY_PREFIX = '/api/v1/icons';

export type WakassetsFolder =
  | 'items'
  | 'monsters'
  | 'monsterIllustrations'
  | 'bossIllustrations'
  | 'monstersfamily'
  | 'rarities'
  | 'itemTypes'
  | 'spells'
  | 'icons'
  | 'aptitudes';

/** `/api/v1/icons/{folder}/{file}` — `file` inclut l'extension (ex. `1234.png`, `default.png`). */
export function wakassetsIconUrl(folder: WakassetsFolder, file: string): string {
  return `${WAKASSETS_PROXY_PREFIX}/${folder}/${file}`;
}

/**
 * Réécrit une URL amont `https://vertylo.github.io/wakassets/X/Y.png` en `/api/v1/icons/X/Y.png`.
 * Toute autre URL (ex. `static.ankama.com`, déjà relative, `null`) est rendue telle quelle.
 */
export function proxyWakassetsUrl<T extends string | null | undefined>(url: T): T {
  if (typeof url !== 'string' || !url.startsWith(`${WAKASSETS_ORIGIN}/`)) return url;
  return `${WAKASSETS_PROXY_PREFIX}/${url.slice(WAKASSETS_ORIGIN.length + 1)}` as T;
}
