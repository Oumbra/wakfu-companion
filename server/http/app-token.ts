/**
 * Jeton d'application du site (2026-09-21, `docs/analyse-cgu-2026-09-21.md`, recommandation 4,
 * options B + C) — la partie pure, testée à part (`app-token.spec.ts`) ; la route qui l'émet vit
 * dans `functions/api/v1/app/token.ts`, la garde qui l'exige dans `functions/api/_caller.ts`.
 *
 * Pourquoi : les routes référentiel (catalogue, objets, monstres, donjons, butins) servent des
 * données du jeu que le projet s'est engagé à ne pas redistribuer hors de ses deux clients. Le
 * site n'a pas d'identité en mode invité, et `Sec-Fetch-Site: same-origin` — seul garde jusqu'ici
 * — est un en-tête qu'un client non navigateur écrit librement. Ce jeton est l'équivalent, pour le
 * site, de la session `Bearer` de l'overlay : un secret que seul le serveur sait produire, obtenu
 * une fois par navigateur après une vérification Turnstile (voir `server/http/turnstile.ts`), puis
 * présenté en cookie sur chaque requête référentiel.
 *
 * Forme : `<issuedAtMs>.<HMAC-SHA256(secret, "wakfu-companion:app-token:" + issuedAtMs)>` en
 * base64url. Sans état côté serveur (rien en base, rien à purger) : la validité se vérifie par
 * recalcul, l'expiration par l'horodatage embarqué. Un jeton volé reste utilisable jusqu'à son
 * expiration (12 h) — borne acceptée, il ne donne accès qu'à des données déjà servies au site.
 *
 * Cookie `wc_app` : `HttpOnly` (jamais lisible par le JS de la page, donc par une XSS via le chat),
 * `Secure`, `SameSite=Strict` (jamais envoyé depuis une page tierce, même en navigation),
 * `Path=/api/v1` (les routes qui le lisent, et rien d'autre). Les `<img>` du relais d'icônes ne
 * l'exigent PAS (voir `functions/api/_caller.ts`) : une image peut être demandée avant que le
 * jeton n'existe (premier chargement), et ces fichiers sont de toute façon publics sur wakassets.
 *
 * Secret : `APP_TOKEN_SECRET` (variable Pages) ; à défaut, `DATABASE_URL` sert de matière à clé —
 * même repli que `RATE_LIMIT_SALT` (`server/auth/rate-limit.ts`), pour ne jamais signer avec une
 * clé vide. Un secret dédié reste préférable (rotation indépendante ; le changer invalide
 * simplement tous les jetons en cours, chaque navigateur en redemande un).
 */

import { serializeCookie } from '../auth/cookies';
import { timingSafeEqual, toBase64Url } from '../auth/crypto';

export const APP_TOKEN_COOKIE = 'wc_app';
/** 12 h : assez long pour ne pas rejouer Turnstile à chaque session de jeu, assez court pour borner un jeton copié. */
export const APP_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
/** Portée du cookie — les routes `/api/v1/*`, rien d'autre. */
export const APP_TOKEN_COOKIE_PATH = '/api/v1';
/** Code d'erreur renvoyé (corps JSON, champ `code`) quand un appelant same-origin n'a pas de jeton
 * valide — le client (`ApiClientService`) en redemande un et rejoue la requête une fois. */
export const APP_TOKEN_REQUIRED_CODE = 'app_token_required';

/** Tolérance d'horloge : un jeton daté de plus d'une minute dans le futur est refusé. */
const MAX_FUTURE_SKEW_MS = 60 * 1000;

/** Sous-ensemble de `Env` (voir `functions/api/_types.ts`) nécessaire à la signature. */
export interface AppTokenEnv {
  APP_TOKEN_SECRET?: string;
  DATABASE_URL?: string;
}

export function appTokenSecret(env: AppTokenEnv): string {
  return env.APP_TOKEN_SECRET || env.DATABASE_URL || '';
}

async function hmacBase64Url(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return toBase64Url(new Uint8Array(signature));
}

function messageFor(issuedAtMs: number): string {
  return `wakfu-companion:app-token:${issuedAtMs}`;
}

/** Émet un jeton daté de `issuedAtMs` (entier, millisecondes epoch). Lève si le secret est vide :
 * signer avec une clé vide reviendrait à ne pas signer. */
export async function signAppToken(secret: string, issuedAtMs: number): Promise<string> {
  if (!secret) throw new Error('secret de jeton d’application manquant');
  const issuedAt = Math.floor(issuedAtMs);
  return `${issuedAt}.${await hmacBase64Url(secret, messageFor(issuedAt))}`;
}

/**
 * Vrai si `token` a été signé avec `secret`, n'est ni expiré (`ttlMs` depuis son émission) ni daté
 * du futur. `null`/vide → faux, jamais une erreur : l'appelant répond simplement 403.
 */
export async function verifyAppToken(
  secret: string,
  token: string | null | undefined,
  nowMs: number,
  ttlMs = APP_TOKEN_TTL_MS,
): Promise<boolean> {
  if (!secret || !token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return false;
  const issuedAtRaw = token.slice(0, dot);
  if (!/^\d{1,16}$/.test(issuedAtRaw)) return false;
  const issuedAt = Number(issuedAtRaw);
  if (issuedAt > nowMs + MAX_FUTURE_SKEW_MS) return false;
  if (nowMs - issuedAt > ttlMs) return false;
  const expected = await hmacBase64Url(secret, messageFor(issuedAt));
  return timingSafeEqual(expected, token.slice(dot + 1));
}

/** `Set-Cookie` du jeton — voir la doc de tête pour chaque attribut. */
export function appTokenCookie(token: string, ttlMs = APP_TOKEN_TTL_MS): string {
  return serializeCookie(APP_TOKEN_COOKIE, token, {
    maxAgeSeconds: Math.floor(ttlMs / 1000),
    httpOnly: true,
    path: APP_TOKEN_COOKIE_PATH,
    sameSite: 'Strict',
  });
}
