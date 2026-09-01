// Fichier utilitaire (préfixe `_`) : Cloudflare Pages Functions route tout
// fichier de functions/ SAUF ceux préfixés par `_` — voir _types.ts.

import { createDb } from '../../server/db/client';
import { createDbAuthStore } from '../../server/auth/db-store';
import { SESSION_COOKIE, clearedAuthCookies, readCookie } from '../../server/auth/cookies';
import { resolveSession, verifyCsrf } from '../../server/auth/flow';
import type { AuthStore, ProviderId, UserRecord } from '../../server/auth/store';
import type { ProviderCredentials } from '../../server/auth/providers';
import type { Env } from './_types';

/**
 * Colle entre le runtime Pages Functions et la logique d'authentification
 * (server/auth/*, testée sans infrastructure) — lot 5, prompt 5.1.
 */

export function json(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json');
  // Une réponse d'authentification ne doit jamais finir dans un cache
  // intermédiaire ou celui du navigateur.
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

export function jsonError(message: string, status: number, extraHeaders?: HeadersInit): Response {
  return json({ error: message }, status, extraHeaders);
}

export function authStore(env: Env): AuthStore {
  return createDbAuthStore(createDb(env.DATABASE_URL));
}

/**
 * Identifiants OAuth du fournisseur, ou `null` s'ils ne sont pas configurés
 * sur cet environnement — cas normal tant que les secrets ne sont pas posés
 * (voir server/README.md) : les routes répondent alors « fournisseur
 * indisponible » au lieu de tomber en erreur 500, et le mode invité reste
 * évidemment intact.
 */
export function providerCredentials(env: Env, provider: ProviderId): ProviderCredentials | null {
  const clientId = provider === 'discord' ? env.DISCORD_CLIENT_ID : env.GOOGLE_CLIENT_ID;
  const clientSecret =
    provider === 'discord' ? env.DISCORD_CLIENT_SECRET : env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Origine publique du site. `PUBLIC_BASE_URL` prime : l'URL de redirection
 * OAuth doit être déclarée à l'identique chez Discord/Google, or une preview
 * Cloudflare Pages a une URL par déploiement (`<hash>.<projet>.pages.dev`) —
 * s'appuyer sur l'origine de la requête ferait échouer l'échange sur ces
 * URLs. L'origine de la requête ne sert que de repli (développement local).
 */
export function publicBaseUrl(request: Request, env: Env): string {
  return (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, '');
}

export interface AuthenticatedContext {
  store: AuthStore;
  user: UserRecord;
  sessionIdHash: string;
  sessionToken: string;
}

/**
 * Jeton porté par un client natif (overlay, lot L4 de `wakfu-companion-overlay` — voir
 * `server/auth/pairing.ts`) : `Authorization: Bearer <jeton>`, jamais un cookie. Un porteur
 * explicite n'est envoyé QUE par un appelant qui le construit volontairement (contrairement au
 * cookie, qu'un navigateur envoie automatiquement) — c'est précisément ce que le contrôle CSRF
 * cherche à exclure, donc `requireCsrf` n'a pas de sens sur ce chemin et n'est jamais appelé pour
 * une requête authentifiée ainsi (`docs/plan-architecture.md` §7.2 du dépôt overlay).
 */
function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

/**
 * Résout la session du cookie (navigateur) ou du porteur `Authorization: Bearer` (client natif).
 * Renvoie `null` si l'appelant n'est pas connecté (jeton absent, inconnu, expiré ou révoqué) — à
 * traduire en 401 par l'appelant, jamais en erreur serveur : côté client, un 401 fait simplement
 * basculer en mode invité (§7 du plan).
 */
export async function authenticate(
  request: Request,
  env: Env,
): Promise<AuthenticatedContext | null> {
  const token = readBearerToken(request) ?? readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const store = authStore(env);
  const resolved = await resolveSession(store, token, new Date());
  if (!resolved) return null;
  return {
    store,
    user: resolved.user,
    sessionIdHash: resolved.session.idHash,
    sessionToken: token,
  };
}

/** 401 avec effacement des cookies d'authentification (jeton devenu inutilisable). */
export function unauthenticated(): Response {
  const headers = new Headers();
  for (const cookie of clearedAuthCookies()) headers.append('set-cookie', cookie);
  return jsonError('non authentifié', 401, headers);
}

/**
 * Contrôle CSRF double-submit sur les routes mutatives (§7 du plan) :
 * l'en-tête `X-CSRF-Token` doit correspondre au jeton dérivé de la session,
 * que le client récupère dans le cookie `wc_csrf` — seul un script de la même
 * origine peut le lire, là où le cookie de session, lui, serait envoyé
 * automatiquement par le navigateur depuis n'importe quel site.
 * `SameSite=Lax` reste la première barrière ; ceci est la seconde.
 *
 * ⚠ Aucun repli sur le cookie en l'absence d'en-tête : ce serait exactement
 * ce que la protection cherche à empêcher (le cookie voyage tout seul, pas
 * l'en-tête).
 */
export async function requireCsrf(request: Request, auth: AuthenticatedContext): Promise<boolean> {
  return verifyCsrf(auth.sessionToken, request.headers.get('x-csrf-token'));
}
