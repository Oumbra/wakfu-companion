/**
 * Reconnaissance de l'appelant d'une route « référentiel » (catalogue, donjons, relais d'icônes) —
 * la partie pure, sans base ni `Request`, testée à part (`caller.spec.ts`) ; le branchement
 * Pages Functions (403, repli sur la session `Bearer`) vit dans `functions/api/_caller.ts`.
 *
 * Pourquoi (2026-09-20, `docs/analyse-cgu-2026-09-21.md`, recommandations 4 et 8) : ces routes servent des
 * données et des images du jeu — les objets/recettes sous la Licence d'utilisation de données
 * WAKFU (personnelle, non cessible, « dans le cadre de votre Projet », § 1-2), le reste sous
 * l'art. 13.2 des CGU Ankama. Une API ouverte à n'importe quel tiers est une redistribution de
 * fait. Les seuls consommateurs légitimes sont les deux clients du projet, chacun reconnu par une
 * seule signature (décision du mainteneur, 2026-09-20 — ni `Referer`, ni `User-Agent`) :
 *
 * - **le site** : `Sec-Fetch-Site: same-origin`, que tout navigateur récent pose sur un `fetch`
 *   ou une image de la page et qu'aucun script tiers ne peut forger (en-tête interdit) — vrai
 *   aussi sous `ng serve` (le proxy `/api` relaie les en-têtes tels quels) et sur les previews
 *   Cloudflare Pages ;
 * - **l'overlay de bureau** : sa session, `Authorization: Bearer <jeton>` validé par
 *   `authenticate` (voir `functions/api/_caller.ts`) — l'overlay est appairé obligatoirement
 *   depuis le 2026-09-14 et envoie son jeton sur ces routes (`overlay-sync/src/client.rs`).
 *
 * Un `<img>` ou un `fetch` posé sur un autre site arrive avec `Sec-Fetch-Site: cross-site`, un
 * `curl` sans rien : refusés.
 */

/** Sous-ensemble de `Headers` suffisant pour `isSameOriginRequest` (testable sans `Request`). */
export interface HeaderReader {
  get(name: string): string | null;
}

/** La requête vient d'une page du site lui-même (`Sec-Fetch-Site: same-origin`). */
export function isSameOriginRequest(headers: HeaderReader): boolean {
  return headers.get('sec-fetch-site')?.trim().toLowerCase() === 'same-origin';
}
