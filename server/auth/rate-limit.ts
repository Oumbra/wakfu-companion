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

import { sha256Hex } from './crypto';
import { MissingProductionSecretError, isPublicDeployment } from './environment';
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
/** Sondage d'un appairage par l'overlay, par `deviceCode` : rythme ~3s pendant 5 min
 * (`PAIRING_TTL_MS`) ⇒ ~100 appels légitimes, un peu plus à cheval sur deux fenêtres. */
export const PAIR_POLL_RULE: RateLimitRule = { limit: 250, windowMs: 10 * 60 * 1000 };
/** Sondage d'appairage, par IP, AVANT la règle par jeton (audit du 2026-09-23) : sans elle, un
 * appelant qui fait varier le `pollToken` n'est jamais freiné (un compteur neuf par jeton inventé).
 * Laisse passer ~4 overlays qui s'appairent en même temps derrière la même IP. */
export const PAIR_POLL_IP_RULE: RateLimitRule = { limit: 1000, windowMs: 10 * 60 * 1000 };
/** Consultation d'une demande d'appairage par la page `/pair`, par compte (lecture seule, mais
 * c'est un oracle sur les codes en attente : on borne l'énumération). */
export const PAIR_INFO_RULE: RateLimitRule = { limit: 30, windowMs: 10 * 60 * 1000 };
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

/** Clé de comptage du sondage d'appairage : le `pollToken` est un secret (il donne le jeton de
 * session une fois l'appairage confirmé), il n'a pas à apparaître en clair dans `auth_rate_limits`. */
export async function pollTokenBucket(pollToken: string): Promise<string> {
  return `auth:native-poll:token:${(await sha256Hex(pollToken)).slice(0, 32)}`;
}

/** Secrets utilisés pour pseudonymiser l'adresse IP (sous-ensemble de `Env`, voir `functions/api/_types.ts`). */
export interface IpKeyEnv {
  RATE_LIMIT_SALT?: string;
  DATABASE_URL?: string;
  PUBLIC_BASE_URL?: string;
}

/** Longueur du condensat conservé (hex) : 64 bits, largement assez pour ne pas confondre deux appelants. */
const IP_KEY_HEX_LENGTH = 16;

/** Découpe une adresse IPv6 (compressée ou non, suffixe IPv4 et zone admis) en 8 mots de 16 bits. */
function parseIpv6(raw: string): number[] | null {
  let text = raw.trim().toLowerCase();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (!text.includes(':')) return null;

  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    const high = ((v4[0] << 8) | v4[1]).toString(16);
    const low = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const words: number[] = [];
    for (const group of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      words.push(parseInt(group, 16));
    }
    return words;
  };
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !rest) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - rest.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...rest];
}

function parseIpv4(raw: string): number[] | null {
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : null;
}

/**
 * Sujet de comptage dérivé de l'adresse (audit du 2026-09-23) : une adresse IPv4 telle quelle,
 * une adresse IPv6 **tronquée à son /64**. Un abonné IPv6 reçoit couramment un /64 (voire un /56)
 * entier : compter par adresse complète lui laissait 2^64 compteurs neufs, donc aucune limite.
 * Une IPv6 « IPv4-mappée » (`::ffff:a.b.c.d`) est ramenée à son IPv4. Une valeur illisible est
 * comptée telle quelle (elle vient de Cloudflare, pas du client).
 */
export function rateLimitIpSubject(ip: string): string {
  const trimmed = ip.trim();
  if (parseIpv4(trimmed)) return trimmed;
  const words = parseIpv6(trimmed);
  if (!words) return trimmed.toLowerCase();
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff].join('.');
  }
  return `${words
    .slice(0, 4)
    .map((word) => word.toString(16))
    .join(':')}::/64`;
}

/**
 * Secret HMAC de pseudonymisation. `RATE_LIMIT_SALT` ; en développement local seulement, repli sur
 * `DATABASE_URL`. Sur un déploiement public (voir `server/auth/environment.ts`), son absence est
 * une erreur explicite (audit du 2026-09-23) : réutiliser la chaîne de connexion à la base comme
 * clé mélange deux secrets aux cycles de vie différents.
 */
export function rateLimitSecret(env: IpKeyEnv, requestUrl?: string | null): string {
  if (env.RATE_LIMIT_SALT) return env.RATE_LIMIT_SALT;
  if (isPublicDeployment(env, requestUrl)) {
    throw new MissingProductionSecretError('RATE_LIMIT_SALT');
  }
  return env.DATABASE_URL || '';
}

/**
 * Clé de comptage dérivée de l'adresse IP de l'appelant (telle que vue par
 * Cloudflare, jamais un en-tête arbitraire côté client) — **jamais l'IP en
 * clair** : compter des requêtes n'exige aucune réversibilité, et l'adresse IP
 * est une donnée personnelle (minimisation, art. 5.1.c ; écart 4.4 de
 * `docs/analyse-rgpd.md`). `HMAC-SHA256(ip, secret)` tronqué : sans le secret,
 * la table `auth_rate_limits` ne permet pas de retrouver une adresse — un
 * simple SHA-256 non salé serait inversible en quelques secondes sur l'espace
 * IPv4. Le secret est `RATE_LIMIT_SALT` (voir `rateLimitSecret`). Une IPv6
 * est d'abord ramenée à son /64 (`rateLimitIpSubject`). Une rotation du secret
 * ne fait que remettre les compteurs à zéro sur la fenêtre en cours.
 */
export async function clientIpKey(request: Request, env: IpKeyEnv): Promise<string> {
  const ip = rateLimitIpSubject(request.headers.get('cf-connecting-ip') ?? 'unknown');
  const secret = rateLimitSecret(env, request.url);
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
