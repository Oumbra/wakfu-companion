/**
 * Cookies d'authentification (lot 5, prompt 5.1) — voir
 * docs/plan-migration-serveur.md §7.
 *
 * Trois cookies, aucun ne contient de donnée métier :
 * - `wc_session` : jeton de session OPAQUE (256 bits), `httpOnly` + `Secure` +
 *   `SameSite=Lax`. Jamais un JWT, jamais en `localStorage` : l'application
 *   affiche du texte issu du chat de jeu (donc du contenu contrôlé par des
 *   tiers), une XSS suffirait à voler un jeton lisible en JS.
 * - `wc_csrf` : jeton double-submit, volontairement LISIBLE en JS (c'est tout
 *   son principe : le client le recopie dans l'en-tête `X-CSRF-Token`, ce
 *   qu'un site tiers ne peut pas faire faute d'accès au cookie). Il ne donne
 *   aucun accès à lui seul.
 * - `wc_oauth_state` : lie le callback OAuth au navigateur qui a démarré le
 *   flux, en plus de la ligne `oauth_authorizations` côté base. Portée
 *   restreinte à `/api/v1/auth` et durée de vie de 10 minutes.
 *
 * `Secure` est posé inconditionnellement : Cloudflare Pages sert toujours en
 * HTTPS, et les navigateurs traitent `http://localhost` comme une origine
 * sûre (le cookie est donc accepté en `wrangler pages dev`).
 */

export const SESSION_COOKIE = 'wc_session';
export const CSRF_COOKIE = 'wc_csrf';
export const OAUTH_STATE_COOKIE = 'wc_oauth_state';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours, expiration glissante (§7)
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const AUTH_PATH = '/api/v1/auth';

/** Lit un cookie dans l'en-tête `Cookie` d'une requête. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

interface CookieOptions {
  maxAgeSeconds: number;
  httpOnly: boolean;
  path?: string;
}

function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? '/'}`,
    `Max-Age=${options.maxAgeSeconds}`,
    'SameSite=Lax',
    'Secure',
  ];
  if (options.httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

export function sessionCookie(token: string, ttlMs = SESSION_TTL_MS): string {
  return serializeCookie(SESSION_COOKIE, token, {
    maxAgeSeconds: Math.floor(ttlMs / 1000),
    httpOnly: true,
  });
}

export function csrfCookie(token: string, ttlMs = SESSION_TTL_MS): string {
  return serializeCookie(CSRF_COOKIE, token, {
    maxAgeSeconds: Math.floor(ttlMs / 1000),
    httpOnly: false, // lu par le client pour le renvoyer en en-tête (double-submit)
  });
}

export function oauthStateCookie(state: string): string {
  return serializeCookie(OAUTH_STATE_COOKIE, state, {
    maxAgeSeconds: Math.floor(OAUTH_STATE_TTL_MS / 1000),
    httpOnly: true,
    path: AUTH_PATH,
  });
}

function expiredCookie(name: string, path = '/', httpOnly = true): string {
  return serializeCookie(name, '', { maxAgeSeconds: 0, httpOnly, path });
}

/** Cookies d'effacement à poser sur une déconnexion (ou un 401 de session invalide). */
export function clearedAuthCookies(): string[] {
  return [expiredCookie(SESSION_COOKIE), expiredCookie(CSRF_COOKIE, '/', false)];
}

export function clearedOauthStateCookie(): string {
  return expiredCookie(OAUTH_STATE_COOKIE, AUTH_PATH);
}
