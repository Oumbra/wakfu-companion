/**
 * Reconnaissance de l'appelant d'une route « référentiel » (catalogue, donjons, relais d'icônes) —
 * la partie pure, sans base ni `Request`, testée à part (`caller.spec.ts`) ; le branchement
 * Pages Functions (403, repli sur la session `Bearer`) vit dans `functions/api/_caller.ts`.
 *
 * Pourquoi (2026-09-20, `docs/analyse-cgu.md`, recommandations 4 et 8) : ces routes servent des
 * données et des images du jeu — les objets/recettes sous la Licence d'utilisation de données
 * WAKFU (personnelle, non cessible, « dans le cadre de votre Projet », § 1-2), le reste sous
 * l'art. 13.2 des CGU Ankama. Une API ouverte à n'importe quel tiers est une redistribution de
 * fait. Les seuls consommateurs légitimes sont les deux clients du projet : le site et l'overlay de
 * bureau. Il n'y a pas d'authentification possible partout (les `<img>` du site n'envoient pas
 * d'en-tête, l'overlay charge le catalogue avant d'avoir résolu son jeton), donc une reconnaissance
 * par signature de requête :
 *
 * - **site** : `Sec-Fetch-Site: same-origin` (tout navigateur récent le pose sur un `fetch` ou une
 *   image de la page) ou, à défaut (Safari < 16.4), un `Referer` ou `Origin` du même hôte que la
 *   requête — vrai aussi sous `ng serve` (proxy `/api` sans `changeOrigin`, hôte et Referer
 *   restent `localhost:4200`) et sur les previews Cloudflare Pages ;
 * - **overlay** : `User-Agent` parmi `OVERLAY_USER_AGENT_PREFIXES`, sans en-tête de navigateur —
 *   signature de TRANSITION : la signature cible est sa session (`Authorization: Bearer`, voir
 *   `functions/api/_caller.ts`), que l'overlay n'envoie pas encore sur ces routes
 *   (`overlay-sync/src/client.rs`, `fetch_catalog_*`/`fetch_item_detail`/`fetch_dungeons`).
 *   Retirer `ureq/` d'ici quand il le fera.
 *
 * Un `<img>` ou un `fetch` posé sur un autre site arrive avec `Sec-Fetch-Site: cross-site` et son
 * propre Referer, un `curl` sans rien : refusés. Ce n'est pas un contrôle d'accès fort (un
 * `User-Agent` se forge), c'est la limite qui fait la différence entre « nos deux clients » et
 * « n'importe quelle page du web ».
 */

/** Qui appelle : le site (même origine), l'overlay de bureau, ou personne de connu. */
export type Caller = 'site' | 'overlay' | null;

/** Sous-ensemble de `Headers` suffisant pour `identifyCaller` (testable sans `Request`). */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Préfixes de `User-Agent` reconnus comme l'overlay de bureau : `ureq/` est l'agent par défaut de
 * son client HTTP (`overlay-sync/src/client.rs`, aucun en-tête ajouté) ; `wakfu-companion-overlay/`
 * est le nom qu'il pourra déclarer lui-même, accepté d'avance pour que la bascule ne coupe rien.
 */
export const OVERLAY_USER_AGENT_PREFIXES = ['wakfu-companion-overlay/', 'ureq/'] as const;

export function identifyCaller(headers: HeaderReader, requestUrl: string): Caller {
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
