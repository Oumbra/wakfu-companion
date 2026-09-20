/**
 * Relais d'icônes `wakassets` pour l'overlay de bureau ET, depuis le 2026-09-20, pour le site
 * lui-même (`src/app/core/utils/wakassets-url.util.ts` : plus aucune image `vertylo.github.io`
 * chargée directement par le navigateur, l'origine a été retirée d'`img-src` dans
 * `public/_headers`) — la partie pure (validation, URL amont, en-têtes), testée à part ; la route
 * `functions/api/v1/icons/[folder]/[file].ts` ne fait que l'appeler.
 *
 * Pourquoi un relais (2026-09-19, constat C10 de `docs/analyse-rgpd.md` du dépôt
 * `wakfu-companion-overlay`) : l'overlay chargeait ses icônes d'objets, de monstres et de sorts
 * directement depuis `vertylo.github.io` (GitHub Pages), qui voyait donc l'adresse IP de chaque
 * utilisateur et la liste des icônes demandées — de quoi deviner ce qu'il combat ou farme. En
 * passant par ici, seul notre service voit la requête, et il connaît déjà le compte. Le site a
 * suivi le 2026-09-20 (même raisonnement, politique de confidentialité §2 mise à jour).
 *
 * Décision du mainteneur : « quelque chose de simple ». Pas de base, pas de stockage : un `fetch`
 * amont mis en cache à la périphérie Cloudflare, et c'est tout.
 */

/** Origine de `wakassets` — la même que `itemImageCandidates`/`monsterImageCandidates` côté web. */
export const WAKASSETS_ORIGIN = 'https://vertylo.github.io/wakassets';

/**
 * Les dossiers demandés par l'overlay (miroir de `IconRef::primary_folder` et de
 * `WAKASSETS_SPELLS_URL_PREFIX` dans `overlay-engine`) et par le site (`WakassetsFolder` dans
 * `wakassets-url.util.ts` : `bossIllustrations`/`monstersfamily` pour les `pictureUrl` de
 * donjons/familles, `icons`/`aptitudes` pour les onglets de statistiques). Tout autre dossier est
 * refusé : ce relais n'est pas un proxy ouvert vers GitHub Pages.
 */
export const ALLOWED_FOLDERS = new Set([
  'items',
  'monsters',
  'monsterIllustrations',
  'bossIllustrations',
  'monstersfamily',
  'rarities',
  'itemTypes',
  'spells',
  'icons',
  'aptitudes',
]);

/**
 * Un nom de fichier `wakassets` : un `gfxId` numérique (éventuellement négatif : `itemTypes/-1.png`,
 * icône « tous types » de l'arbre de filtre officiel) ou un court nom en minuscules
 * (`bossIllustrations/default.png`, `icons/di.png`), toujours en `.png` — donc jamais de `..`, de
 * `/` ni de paramètre.
 */
const FILE_PATTERN = /^(-?\d{1,12}|[a-z]{1,16})\.png$/;

/** Durée de cache d'une icône trouvée — les `gfxId` sont stables, une image ne change pour ainsi
 * dire jamais : une semaine à la périphérie et chez le client. */
export const HIT_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
/** Durée de cache d'un 404 amont — court : une icône peut apparaître au prochain import
 * `wakassets`, et l'overlay retente de lui-même à son prochain lancement. */
export const MISS_MAX_AGE_SECONDS = 60 * 60;

export type IconRequest = { folder: string; file: string };

/**
 * L'URL amont pour `folder/file`, ou `null` si la requête sort de ce que le relais accepte
 * (dossier inconnu, nom de fichier qui n'est pas `<nombre>.png` — donc aucun `..`, aucun `/`).
 */
export function upstreamUrl({ folder, file }: IconRequest): string | null {
  if (!ALLOWED_FOLDERS.has(folder) || !FILE_PATTERN.test(file)) return null;
  return `${WAKASSETS_ORIGIN}/${folder}/${file}`;
}

/**
 * Les en-têtes de la réponse relayée. On ne recopie **rien** de l'amont (ni `ETag`, ni `Server`,
 * ni cookies éventuels) : le type est connu (`wakassets` ne sert que du PNG), le reste ne regarde
 * pas le client.
 */
export function relayHeaders(status: 200 | 404): Record<string, string> {
  const maxAge = status === 200 ? HIT_MAX_AGE_SECONDS : MISS_MAX_AGE_SECONDS;
  return {
    'content-type': status === 200 ? 'image/png' : 'application/json',
    'cache-control': `public, max-age=${maxAge}`,
    // Pas d'`access-control-allow-origin: *` (retiré le 2026-09-20, `docs/analyse-cgu.md`,
    // recommandation 8) : le site est de même origine et l'overlay n'est pas un navigateur —
    // l'en-tête ne servait qu'à un tiers, que `identifyCaller` refuse désormais.
  };
}

/** Qui appelle le relais : le site (même origine), l'overlay de bureau, ou personne de connu. */
export type IconCaller = 'site' | 'overlay' | null;

/** Sous-ensemble de `Headers` suffisant pour `identifyCaller` (testable sans `Request`). */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Préfixes de `User-Agent` reconnus comme l'overlay de bureau : `ureq/` est l'agent par défaut de
 * son client HTTP (`overlay-sync/src/client.rs`, aucun en-tête ajouté — les icônes sont chargées
 * avant même l'appairage, donc sans jeton) ; `wakfu-companion-overlay/` est le nom qu'il pourra
 * déclarer lui-même, accepté d'avance pour que la bascule ne coupe rien.
 */
export const OVERLAY_USER_AGENT_PREFIXES = ['wakfu-companion-overlay/', 'ureq/'] as const;

/**
 * Le relais ne sert que ses deux consommateurs (2026-09-20, `docs/analyse-cgu.md`, recommandation
 * 8 : ne pas devenir un CDN public d'images Ankama — art. 13.2 des CGU). Il n'y a pas
 * d'authentification possible (icônes chargées avant l'appairage, `<img>` sans en-tête), donc une
 * reconnaissance par signature de requête :
 *
 * - **site** : `Sec-Fetch-Site: same-origin` (tout navigateur récent le pose sur une image de la
 *   page) ou, à défaut (Safari < 16.4), un `Referer` ou `Origin` du même hôte que la requête —
 *   vrai aussi sous `ng serve` (proxy `/api` sans `changeOrigin`, hôte et Referer restent
 *   `localhost:4200`) et sur les previews Cloudflare Pages ;
 * - **overlay** : `User-Agent` parmi `OVERLAY_USER_AGENT_PREFIXES`, sans en-tête de navigateur.
 *
 * Un `<img>` posé sur un autre site arrive avec `Sec-Fetch-Site: cross-site` et son propre
 * Referer, un `curl` sans rien : refusés (403 par la route). Ce n'est pas un contrôle d'accès fort
 * (un `User-Agent` se forge), c'est la limite qui fait la différence entre « nos deux clients » et
 * « n'importe quelle page du web ».
 */
export function identifyCaller(headers: HeaderReader, requestUrl: string): IconCaller {
  if (headers.get('sec-fetch-site')?.toLowerCase() === 'same-origin') return 'site';
  const host = hostOf(requestUrl);
  if (host !== null) {
    for (const name of ['referer', 'origin']) {
      const value = headers.get(name);
      if (value !== null && hostOf(value) === host) return 'site';
    }
  }
  const userAgent = headers.get('user-agent') ?? '';
  if (OVERLAY_USER_AGENT_PREFIXES.some((prefix) => userAgent.startsWith(prefix))) return 'overlay';
  return null;
}

/** `host` (nom + port) d'une URL absolue, `null` si elle ne se parse pas (Referer tronqué, `null`). */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}
