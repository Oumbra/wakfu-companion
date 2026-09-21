/**
 * Limitation de débit des routes `/auth/*`, par IP et par compte.
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
/** Émission du jeton d'application (`POST /api/v1/app/token`), par IP : un navigateur en demande un
 * toutes les 12 h, quelques-uns de plus en cas d'échec Turnstile ou de plusieurs profils derrière une
 * même IP — 20 par 10 min laisse large, et borne le coût `siteverify` d'un appelant abusif. */
export const APP_TOKEN_RULE: RateLimitRule = { limit: 20, windowMs: 10 * 60 * 1000 };

/**
 * Fenêtre la plus longue de toutes les règles ci-dessus. Passé ce délai, une ligne
 * `auth_rate_limits` ne sert plus à aucun comptage et n'a plus à exister — c'est le délai annoncé
 * par la politique de confidentialité (§5, « effacé au bout d'une fenêtre de 10 minutes »).
 * Utilisé par la purge planifiée (`server/import/run-retention-purges.ts`), là où la purge
 * opportuniste de `checkRateLimit` ne nettoie qu'au prochain appel de la même règle.
 */
export const MAX_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

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

/** Secrets utilisés pour pseudonymiser l'adresse IP (sous-ensemble de `Env`, voir `functions/api/_types.ts`). */
export interface IpKeyEnv {
  RATE_LIMIT_SALT?: string;
  DATABASE_URL?: string;
}

/** Longueur du condensat conservé (hex) : 64 bits, largement assez pour ne pas confondre deux appelants. */
const IP_KEY_HEX_LENGTH = 16;

/**
 * Clé de comptage dérivée de l'adresse IP de l'appelant (telle que vue par
 * Cloudflare, jamais un en-tête arbitraire côté client) — **jamais l'IP en
 * clair** : compter des requêtes n'exige aucune réversibilité, et l'adresse IP
 * est une donnée personnelle (minimisation, art. 5.1.c ; écart 4.4 de
 * `docs/analyse-rgpd.md`). `HMAC-SHA256(ip, secret)` tronqué : sans le secret,
 * la table `auth_rate_limits` ne permet pas de retrouver une adresse — un
 * simple SHA-256 non salé serait inversible en quelques secondes sur l'espace
 * IPv4. Le secret est `RATE_LIMIT_SALT` ; à défaut, `DATABASE_URL` (toujours
 * présent, jamais public) sert de matière à clé, pour que le repli ne soit
 * jamais un hachage non salé. Une rotation du secret ne fait que remettre les
 * compteurs à zéro sur la fenêtre en cours.
 */
export async function clientIpKey(request: Request, env: IpKeyEnv): Promise<string> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const secret = env.RATE_LIMIT_SALT || env.DATABASE_URL || '';
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`wakfu-companion:rate-limit:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(ip)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, IP_KEY_HEX_LENGTH);
}
