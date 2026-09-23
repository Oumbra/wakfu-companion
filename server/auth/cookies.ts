/**
 * Cookies d'authentification (lot 5, prompt 5.1) — voir server/README.md,
 * section « Authentification ».
 *
 * Trois cookies, aucun ne contient de donnée métier (noms préfixés depuis le 2026-09-23, voir
 * plus bas) :
 * - `__Host-wc_session` : jeton de session OPAQUE (256 bits), `httpOnly` + `Secure` +
 *   `SameSite=Lax`. Jamais un JWT, jamais en `localStorage` : l'application
 *   affiche du texte issu du chat de jeu (donc du contenu contrôlé par des
 *   tiers), une XSS suffirait à voler un jeton lisible en JS.
 * - `__Host-wc_csrf` : jeton double-submit, volontairement LISIBLE en JS (c'est tout
 *   son principe : le client le recopie dans l'en-tête `X-CSRF-Token`, ce
 *   qu'un site tiers ne peut pas faire faute d'accès au cookie). Il ne donne
 *   aucun accès à lui seul.
 * - `__Secure-wc_oauth_state` : lie le callback OAuth au navigateur qui a démarré le
 *   flux, en plus de la ligne `oauth_authorizations` côté base. Portée
 *   restreinte à `/api/v1/auth` et durée de vie de 10 minutes.
 *
 * `Secure` est posé inconditionnellement : Cloudflare Pages sert toujours en
 * HTTPS, et les navigateurs traitent `http://localhost` comme une origine
 * sûre (le cookie est donc accepté en `wrangler pages dev`).
 */

/**
 * Préfixes de nom de cookie (RFC 6265bis §4.1.3) — audit de sécurité du 2026-09-23 :
 * - `__Host-` : le navigateur n'accepte le cookie que s'il est `Secure`, posé depuis une origine
 *   sûre, avec `Path=/` et SANS `Domain`. Un sous-domaine (ou un voisin réseau en HTTP) ne peut
 *   donc ni le poser ni l'écraser : ferme la fixation de session par « cookie tossing ».
 * - `__Secure-` pour `wc_oauth_state`, dont la portée reste restreinte à `/api/v1/auth`
 *   (`__Host-` imposerait `Path=/`).
 *
 * Développement local : `wrangler pages dev` (http://localhost:8788) derrière le proxy du
 * serveur Angular (http://localhost:4200). Chrome et Firefox traitent `http://localhost` comme une
 * origine sûre, `Secure` et les préfixes y sont acceptés — rien ne change par rapport à avant,
 * `Secure` était déjà posé inconditionnellement.
 */
export const SESSION_COOKIE = '__Host-wc_session';
export const CSRF_COOKIE = '__Host-wc_csrf';
export const OAUTH_STATE_COOKIE = '__Secure-wc_oauth_state';

/**
 * TRANSITION (2026-09-23) — anciens noms, sans préfixe. Encore ACCEPTÉS en lecture pour ne pas
 * déconnecter tout le monde au déploiement : `readSessionCookie` retombe sur l'ancien nom, et
 * `GET /api/v1/auth/me` (appelé à chaque démarrage du site) réécrit alors la session sous le
 * nouveau nom et efface l'ancien. Toute déconnexion efface les deux noms.
 *
 * À retirer une fois la durée de vie maximale d'un ancien cookie écoulée (`SESSION_TTL_MS` après
 * le déploiement, soit au plus tard le 2026-10-23 pour un déploiement le 2026-09-23) : supprimer
 * ces constantes, `LEGACY_*` dans `readSessionCookie`/`clearedAuthCookies`, et
 * `EMIT_LEGACY_CSRF_COOKIE`.
 */
export const LEGACY_SESSION_COOKIE = 'wc_session';
export const LEGACY_CSRF_COOKIE = 'wc_csrf';
export const LEGACY_OAUTH_STATE_COOKIE = 'wc_oauth_state';

/**
 * Le cookie CSRF est lu en JS par le client (`readCsrfCookie`, `src/app/core/api/
 * api-client.service.ts`). Tant que le client ne lit que l'ancien nom `wc_csrf`, le serveur pose
 * AUSSI ce nom (même valeur, dérivée de la session) à côté de `__Host-wc_csrf`. Sans danger : sa
 * valeur est un hachage du jeton de session, un cookie `wc_csrf` injecté par un tiers ne vaut
 * rien (`verifyCsrf` recalcule l'attendu depuis la session). Passer à `false` quand le client lit
 * `__Host-wc_csrf` en priorité et que les onglets ouverts avant ce déploiement ont disparu.
 */
export const EMIT_LEGACY_CSRF_COOKIE = true;

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours, expiration glissante
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const AUTH_PATH = '/api/v1/auth';

/**
 * Lit un cookie dans l'en-tête `Cookie` d'une requête. Une valeur mal encodée (`%` orphelin,
 * séquence UTF-8 invalide) rend `null` au lieu de lever : `decodeURIComponent` lève `URIError`, ce
 * qui transformait un cookie forgé en 500 sur toute route authentifiée.
 */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** Jeton de session du cookie : nouveau nom d'abord, ancien nom en repli (voir TRANSITION). */
export function readSessionCookie(request: Request): { token: string; legacy: boolean } | null {
  const current = readCookie(request, SESSION_COOKIE);
  if (current) return { token: current, legacy: false };
  const legacy = readCookie(request, LEGACY_SESSION_COOKIE);
  if (legacy) return { token: legacy, legacy: true };
  return null;
}

/** `state` OAuth du cookie : nouveau nom d'abord, ancien nom en repli (flux démarré avant le déploiement). */
export function readOauthStateCookie(request: Request): string | null {
  return readCookie(request, OAUTH_STATE_COOKIE) ?? readCookie(request, LEGACY_OAUTH_STATE_COOKIE);
}

/** Vrai si la requête porte un cookie CSRF (nouveau ou ancien nom). */
export function hasCsrfCookie(request: Request): boolean {
  return (
    readCookie(request, CSRF_COOKIE) !== null ||
    (EMIT_LEGACY_CSRF_COOKIE && readCookie(request, LEGACY_CSRF_COOKIE) !== null)
  );
}

interface CookieOptions {
  maxAgeSeconds: number;
  httpOnly: boolean;
  path?: string;
  /** `Lax` par défaut (cookies d'authentification : le retour OAuth est une navigation
   * cross-site) ; `Strict` pour le jeton d'application (`server/http/app-token.ts`), qui ne
   * sert qu'à des requêtes émises par la page elle-même. */
  sameSite?: 'Lax' | 'Strict';
}

/** Exporté pour `server/http/app-token.ts` (cookie `wc_app`) — même sérialisation, mêmes attributs par défaut. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? '/'}`,
    `Max-Age=${options.maxAgeSeconds}`,
    `SameSite=${options.sameSite ?? 'Lax'}`,
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

/** `Set-Cookie` du jeton CSRF — un ou deux en-têtes selon `EMIT_LEGACY_CSRF_COOKIE`. */
export function csrfCookies(token: string, ttlMs = SESSION_TTL_MS): string[] {
  const options = {
    maxAgeSeconds: Math.floor(ttlMs / 1000),
    httpOnly: false, // lu par le client pour le renvoyer en en-tête (double-submit)
  };
  const cookies = [serializeCookie(CSRF_COOKIE, token, options)];
  if (EMIT_LEGACY_CSRF_COOKIE) cookies.push(serializeCookie(LEGACY_CSRF_COOKIE, token, options));
  return cookies;
}

/**
 * Cookies à poser sur une connexion (ou une migration de nom) : session + CSRF sous les
 * nouveaux noms, ancien cookie de session effacé.
 */
export function sessionCookies(
  sessionToken: string,
  csrfToken: string,
  ttlMs = SESSION_TTL_MS,
): string[] {
  return [
    sessionCookie(sessionToken, ttlMs),
    ...csrfCookies(csrfToken, ttlMs),
    expiredCookie(LEGACY_SESSION_COOKIE),
  ];
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

/** Cookies d'effacement à poser sur une déconnexion (ou un 401 de session invalide) — les deux noms. */
export function clearedAuthCookies(): string[] {
  return [
    expiredCookie(SESSION_COOKIE),
    expiredCookie(CSRF_COOKIE, '/', false),
    expiredCookie(LEGACY_SESSION_COOKIE),
    expiredCookie(LEGACY_CSRF_COOKIE, '/', false),
  ];
}

export function clearedOauthStateCookies(): string[] {
  return [
    expiredCookie(OAUTH_STATE_COOKIE, AUTH_PATH),
    expiredCookie(LEGACY_OAUTH_STATE_COOKIE, AUTH_PATH),
  ];
}
