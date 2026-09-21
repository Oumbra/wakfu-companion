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
    // Pas d'`access-control-allow-origin: *` (retiré le 2026-09-20, `docs/analyse-cgu-2026-09-21.md`,
    // recommandation 8) : le site est de même origine et l'overlay n'est pas un navigateur —
    // l'en-tête ne servait qu'à un tiers, que `rejectUnknownCaller` (`functions/api/_caller.ts`)
    // refuse désormais.
  };
}
