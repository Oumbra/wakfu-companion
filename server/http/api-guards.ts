/**
 * Garde-fous communs aux routes coûteuses de l'API de compte (`/history/*`, `/settings`) :
 * limitation de débit PAR COMPTE et réponse 500 générique.
 *
 * ## Limitation de débit par compte
 *
 * Réutilise le mécanisme des routes `/auth/*` (`server/auth/rate-limit.ts`, table
 * `auth_rate_limits`, une seule requête SQL par appel) — pas de second mécanisme à maintenir. Le
 * rate limiting de périphérie Cloudflare n'étant pas disponible sur le plan du projet (voir
 * server/README.md, « Rate limiting de périphérie »), c'est ce qui borne le coût (compute Neon,
 * volume stocké) d'un compte abusif ou d'un client bogué qui boucle.
 *
 * **Fenêtre de 10 minutes, obligatoirement** (`MAX_RATE_LIMIT_WINDOW_MS`) : la purge
 * opportuniste de `checkRateLimit` efface TOUTES les lignes `auth_rate_limits` plus anciennes
 * qu'une fenêtre de la règle appelante, tous compartiments confondus — une règle à fenêtre plus
 * courte remettrait à zéro les compteurs des routes d'authentification, une règle plus longue
 * verrait ses propres lignes purgées par elles, et la durée de conservation annoncée par la
 * politique de confidentialité (§5, 10 minutes) ne serait plus exacte. Les compartiments portent
 * l'identifiant du compte, comme ceux des routes de session existantes (`auth:session:user:<id>`) :
 * aucune nouvelle catégorie de donnée.
 *
 * ## Calibrage (cadence réelle des clients, 2026-09-23)
 *
 * - Historique (`POST /history/{fights,purchases,trades,pacts}`) : la file cliente
 *   (`core/sync/sync-queue.service.ts`) regroupe ses envois toutes les 2 s au plus (debounce) et
 *   découpe en lots de 50 ; un flush envoie au plus une requête par type. En jeu : une poignée de
 *   requêtes par minute. Au premier chargement d'un gros `wakfu.log` (ou à une reconnexion, qui
 *   relit tout le fichier) : une rafale d'une requête par lot de 50 événements. 600 requêtes par
 *   10 min = 30 000 événements en rafale, overlay et autres onglets du même compte compris. Au-delà,
 *   un 429 : la file le traite comme un échec réessayable (jamais comme un refus définitif), garde
 *   ses entrées et réessaie avec un délai croissant (15 s → 5 min) — aucune perte.
 * - Agrégat de période (`GET /history/stats`, treize `SELECT`) : une requête par changement de
 *   période dans la carte Récap, les périodes passées étant mises en cache côté client. 120 par
 *   10 min laisse une navigation frénétique passer.
 * - Configuration (`PATCH`/`PUT /settings`) : debounce client de 1,5 s, écritures fréquentes en
 *   farm (compteurs de la watchlist) — au plus ~400 par 10 min en continu. 600 par 10 min. Un 429
 *   laisse les clés en attente côté client, renvoyées à l'écriture suivante.
 */

import { MAX_RATE_LIMIT_WINDOW_MS, checkRateLimit, type RateLimitRule } from '../auth/rate-limit';
import type { AuthStore } from '../auth/store';

/** Écritures d'historique, les quatre types confondus. Voir le calibrage en tête de fichier. */
export const HISTORY_WRITE_RULE: RateLimitRule = { limit: 600, windowMs: MAX_RATE_LIMIT_WINDOW_MS };
/** Agrégat par période (`GET /history/stats`). */
export const HISTORY_STATS_RULE: RateLimitRule = { limit: 120, windowMs: MAX_RATE_LIMIT_WINDOW_MS };
/** Écritures de configuration (`PATCH`/`PUT /settings`). */
export const SETTINGS_WRITE_RULE: RateLimitRule = {
  limit: 600,
  windowMs: MAX_RATE_LIMIT_WINDOW_MS,
};

export type UserLimitedAction = 'history:write' | 'history:stats' | 'settings:write';

const RULE_BY_ACTION: Record<UserLimitedAction, RateLimitRule> = {
  'history:write': HISTORY_WRITE_RULE,
  'history:stats': HISTORY_STATS_RULE,
  'settings:write': SETTINGS_WRITE_RULE,
};

/** Compartiment de comptage d'une action pour un compte — ex. `history:write:user:<uuid>`. */
export function userRateLimitBucket(action: UserLimitedAction, userId: string): string {
  return `${action}:user:${userId}`;
}

function jsonResponse(body: unknown, status: number, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders },
  });
}

/**
 * `null` si le compte peut poursuivre, sinon la réponse 429 (avec `Retry-After`) à renvoyer telle
 * quelle. Une panne de la table de comptage ne bloque jamais l'utilisateur (on laisse passer en
 * le journalisant) : le garde-fou est un frein à l'abus, pas une dépendance de disponibilité.
 */
export async function enforceUserRateLimit(
  store: AuthStore,
  action: UserLimitedAction,
  userId: string,
  now: Date = new Date(),
): Promise<Response | null> {
  let result: Awaited<ReturnType<typeof checkRateLimit>>;
  try {
    result = await checkRateLimit(
      store,
      userRateLimitBucket(action, userId),
      RULE_BY_ACTION[action],
      now,
    );
  } catch (error) {
    console.error(`[rate-limit] ${action} : comptage indisponible`, error);
    return null;
  }
  if (result.allowed) return null;
  return jsonResponse({ error: 'trop de requêtes', code: 'rate_limited' }, 429, {
    'retry-after': String(result.retryAfterSeconds),
  });
}

/**
 * Réponse 500 générique : l'erreur (message Postgres, pile, nom de contrainte...) est journalisée
 * côté serveur (`console.error`, visible dans les journaux Cloudflare), JAMAIS renvoyée au client.
 */
export function internalErrorResponse(label: string, error: unknown): Response {
  console.error(`[${label}]`, error);
  return jsonResponse({ error: 'erreur interne' }, 500);
}
