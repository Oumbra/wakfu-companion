/**
 * Limitation de débit des routes `/auth/*` (§7 du plan : « par IP et par
 * compte »).
 *
 * Fenêtres fixes plutôt que glissantes : une ligne `(bucket, window_start)`
 * incrémentée par upsert, ce qui tient en une seule requête SQL — important
 * ici, le driver `neon-http` n'offrant pas de transaction interactive (voir
 * server/db/client.ts). Le défaut connu de la fenêtre fixe (jusqu'à 2× la
 * limite à cheval sur deux fenêtres) est sans conséquence pour un usage
 * anti-abus de routes de connexion.
 */

import type { AuthStore } from './store';

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

/** Démarrage d'un flux OAuth : large, ces appels sont légitimes en rafale (aller-retour, retour arrière...). */
export const START_RULE: RateLimitRule = { limit: 20, windowMs: 10 * 60 * 1000 };
/** Retour OAuth : plus serré, c'est la route qui écrit en base et appelle le fournisseur. */
export const CALLBACK_RULE: RateLimitRule = { limit: 15, windowMs: 10 * 60 * 1000 };
/** Routes de session (logout, révocation, suppression de compte). */
export const SESSION_RULE: RateLimitRule = { limit: 60, windowMs: 10 * 60 * 1000 };
/** Démarrage d'un appairage natif (overlay), par IP : large, comme START_RULE. */
export const PAIR_RULE: RateLimitRule = { limit: 20, windowMs: 10 * 60 * 1000 };
/** Confirmation d'un appairage (navigateur connecté) : plus serré, écrit en base. */
export const PAIR_CLAIM_RULE: RateLimitRule = { limit: 15, windowMs: 10 * 60 * 1000 };
/** Sondage d'un appairage par l'overlay, par `deviceCode` : rythme ~3s pendant 10 min ⇒ jusqu'à ~200 appels légitimes. */
export const PAIR_POLL_RULE: RateLimitRule = { limit: 250, windowMs: 10 * 60 * 1000 };

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export async function checkRateLimit(
  store: AuthStore,
  bucket: string,
  rule: RateLimitRule,
  now: Date,
): Promise<RateLimitResult> {
  const windowStartMs = Math.floor(now.getTime() / rule.windowMs) * rule.windowMs;
  const windowStart = new Date(windowStartMs);
  const count = await store.bumpRateLimit(bucket, windowStart);

  // Purge opportuniste des fenêtres passées, déclenchée sur la PREMIÈRE requête
  // d'une fenêtre (déterministe et rare, contrairement à un tirage aléatoire) —
  // Cloudflare Pages n'offre pas de Cron Trigger pour le faire ailleurs.
  if (count === 1) {
    await store.purgeRateLimits(new Date(windowStartMs - rule.windowMs));
  }

  return {
    allowed: count <= rule.limit,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((windowStartMs + rule.windowMs - now.getTime()) / 1000),
    ),
  };
}

/** Adresse IP de l'appelant telle que vue par Cloudflare (jamais un en-tête arbitraire côté client). */
export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}
