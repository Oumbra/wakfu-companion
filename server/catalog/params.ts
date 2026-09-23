/**
 * Validation pure des paramètres des routes référentiel (`items/{id}`, `monsters/{id}`,
 * `catalog/search`) — correctif du 2026-09-23 (audit sécurité). Testée dans `params.spec.ts`.
 */

/** Borne d'une colonne Postgres `integer` (miroir de `PG_INT32_MAX`, server/history/parse.ts). */
const PG_INT32_MAX = 2_147_483_647;

/**
 * Identifiant Ankama (`items.ankama_id`, `monsters.id`, colonnes `integer`) : entier décimal
 * strictement positif, au plus `PG_INT32_MAX`, `null` sinon (→ 400). `Number(raw)` seul acceptait
 * `1e3`, ` 12 `, `0x10`, des négatifs et des valeurs hors `integer`, ces dernières faisant échouer
 * la requête SQL en 500.
 */
export function parseAnkamaId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d{0,9}$/.test(raw)) return null;
  const id = Number(raw);
  return id <= PG_INT32_MAX ? id : null;
}

/** Longueur acceptée pour `q` (`GET /api/v1/catalog/search`), après `trim`. */
export const SEARCH_QUERY_MIN_LENGTH = 2;
export const SEARCH_QUERY_MAX_LENGTH = 64;

/**
 * Échappe les métacaractères de `LIKE`/`ILIKE` (`\`, `%`, `_`) : sans ça, `q=%` ou `q=_`
 * transformait la recherche par sous-chaîne en balayage complet de la table (chaque ligne
 * correspond), et `q=%a%b%c%...` en motif à retour arrière coûteux. `\` est le caractère
 * d'échappement PAR DÉFAUT de Postgres pour `LIKE`/`ILIKE` (tant que
 * `standard_conforming_strings` est actif, défaut depuis 9.1 — et le motif est de toute façon
 * passé en paramètre lié, jamais en littéral SQL) : pas besoin de clause `ESCAPE` explicite,
 * `ilike()` de drizzle suffit.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export type SearchQueryResult = { ok: true; pattern: string } | { ok: false; error: string };

/** `q` validé (2..64 caractères après `trim`) et converti en motif `%…%` échappé. */
export function parseSearchQuery(raw: string | null): SearchQueryResult {
  const q = (raw ?? '').trim();
  if (q.length < SEARCH_QUERY_MIN_LENGTH || q.length > SEARCH_QUERY_MAX_LENGTH) {
    return {
      ok: false,
      error: `q invalide (${SEARCH_QUERY_MIN_LENGTH} à ${SEARCH_QUERY_MAX_LENGTH} caractères)`,
    };
  }
  return { ok: true, pattern: `%${escapeLikePattern(q)}%` };
}
