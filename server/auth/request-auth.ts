/**
 * Lecture de l'identifiant de session porté par une requête — partie pure de
 * `functions/api/_auth.ts::authenticate`, testée ici sans runtime Pages (`request-auth.spec.ts`).
 *
 * Audit de sécurité du 2026-09-23 : `requireCsrf` exemptait toute requête dont l'en-tête
 * `Authorization` COMMENÇAIT par `Bearer `, alors que `authenticate` retombait sur le cookie quand
 * le porteur était inutilisable (`Bearer ` suivi d'une espace insécable, par exemple). Un site
 * tiers ne peut pas poser cet en-tête sur une requête simple, mais la combinaison « exemption sur
 * la forme de l'en-tête » + « authentification par le cookie » est exactement l'incohérence qu'une
 * variante de requête finit par exploiter. Désormais :
 * - la source de l'authentification est renvoyée explicitement (`via`), et c'est ELLE qui décide
 *   de l'exemption CSRF (`isCsrfExempt`) ;
 * - dès qu'un en-tête `Authorization` est présent, le cookie n'est JAMAIS consulté : un porteur mal
 *   formé est un échec d'authentification (401), pas un repli silencieux.
 */

import { readSessionCookie } from './cookies';
import { isNativeSession } from './pairing';
import type { SessionRecord } from './store';

export type AuthVia = 'bearer' | 'cookie';

export type RequestCredential =
  /** Ni en-tête `Authorization`, ni cookie de session : appelant invité. */
  | { kind: 'none' }
  /** En-tête `Authorization` présent mais inutilisable : refusé, sans repli sur le cookie. */
  | { kind: 'invalid' }
  | {
      kind: 'token';
      token: string;
      via: AuthVia;
      /** Cookie lu sous l'ancien nom sans préfixe (transition `__Host-`, voir cookies.ts). */
      legacyCookie: boolean;
    };

/**
 * `Authorization: Bearer <b64token>` (RFC 6750 §2.1) — schéma insensible à la casse, UNE espace,
 * jeton limité à l'alphabet `b64token`, 512 caractères au plus. Nos jetons sont en base64url
 * (43 caractères) : tout ce qui sort de cette forme n'a pas été émis ici.
 */
const BEARER_PATTERN = /^Bearer ([A-Za-z0-9\-._~+/]{1,512}=*)$/i;

export function readRequestCredential(request: Request, now: Date = new Date()): RequestCredential {
  const authorization = request.headers.get('authorization');
  if (authorization !== null) {
    const match = BEARER_PATTERN.exec(authorization);
    if (!match) return { kind: 'invalid' };
    return { kind: 'token', token: match[1], via: 'bearer', legacyCookie: false };
  }
  // Repli sur l'ancien nom `wc_session` borné par une date butoir (voir cookies.ts, TRANSITION).
  const cookie = readSessionCookie(request, now);
  if (!cookie) return { kind: 'none' };
  return { kind: 'token', token: cookie.token, via: 'cookie', legacyCookie: cookie.legacy };
}

/**
 * Seul un porteur explicite dispense du contrôle CSRF : un navigateur ne l'envoie jamais de
 * lui-même, contrairement au cookie. Décidé sur la source EFFECTIVE de l'authentification.
 */
export function isCsrfExempt(via: AuthVia): boolean {
  return via === 'bearer';
}

/**
 * Vrai si l'appelant est un client natif (overlay) : porteur `Authorization: Bearer`, OU session
 * émise par appairage natif même présentée en cookie (un jeton d'overlay copié, rejoué en cookie
 * avec un `X-CSRF-Token` recalculé — la dérivation CSRF est publique). Sert à refuser les routes
 * d'administration du compte aux jetons natifs (`rejectNativeCaller`, `functions/api/_auth.ts`).
 */
export function isNativeCaller(via: AuthVia, session: SessionRecord): boolean {
  return via === 'bearer' || isNativeSession(session);
}
