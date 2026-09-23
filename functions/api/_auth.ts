// Fichier utilitaire (préfixe `_`) : Cloudflare Pages Functions route tout
// fichier de functions/ SAUF ceux préfixés par `_` — voir _types.ts.

import { createDb } from '../../server/db/client';
import { createDbAuthStore } from '../../server/auth/db-store';
import { clearedAuthCookies } from '../../server/auth/cookies';
import { resolveSession, verifyCsrf } from '../../server/auth/flow';
import {
  isCsrfExempt,
  isNativeCaller,
  readRequestCredential,
} from '../../server/auth/request-auth';
import type { AuthVia } from '../../server/auth/request-auth';
import type { AuthStore, ProviderId, SessionRecord, UserRecord } from '../../server/auth/store';
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
  /** Ligne de session telle que résolue (déjà lue : pas de second SELECT pour qui en a besoin). */
  session: SessionRecord;
  /**
   * Source EFFECTIVE de l'authentification (audit du 2026-09-23) : `bearer` = en-tête
   * `Authorization: Bearer` (client natif), `cookie` = cookie de session (navigateur). C'est elle,
   * et non la forme de l'en-tête, qui décide de l'exemption CSRF (`requireCsrf`).
   */
  via: AuthVia;
  /** Session lue sous l'ancien nom de cookie `wc_session` (transition `__Host-`, voir cookies.ts). */
  legacyCookie: boolean;
}

/**
 * Résout la session du cookie (navigateur) ou du porteur `Authorization: Bearer` (client natif,
 * overlay — lot L4 de `wakfu-companion-overlay`, voir `server/auth/pairing.ts`). Renvoie `null` si
 * l'appelant n'est pas connecté (jeton absent, inconnu, expiré ou révoqué) — à traduire en 401 par
 * l'appelant, jamais en erreur serveur : côté client, un 401 fait simplement basculer en mode
 * invité.
 *
 * Un porteur explicite n'est envoyé QUE par un appelant qui le construit volontairement
 * (contrairement au cookie, qu'un navigateur envoie automatiquement) : c'est ce qui dispense ce
 * chemin du contrôle CSRF. Dès qu'un en-tête `Authorization` est présent, le cookie n'est JAMAIS
 * consulté — un porteur mal formé vaut `null`, pas un repli sur le cookie (audit du 2026-09-23,
 * voir `server/auth/request-auth.ts`).
 */
export async function authenticate(
  request: Request,
  env: Env,
): Promise<AuthenticatedContext | null> {
  const credential = readRequestCredential(request);
  if (credential.kind !== 'token') return null;
  const store = authStore(env);
  const resolved = await resolveSession(store, credential.token, new Date());
  if (!resolved) return null;
  return {
    store,
    user: resolved.user,
    sessionIdHash: resolved.session.idHash,
    sessionToken: credential.token,
    session: resolved.session,
    via: credential.via,
    legacyCookie: credential.legacyCookie,
  };
}

/**
 * Portée des jetons natifs (audit du 2026-09-23) : un jeton d'overlay sert à synchroniser
 * l'historique et à gérer SA propre session (`/native/session`), pas à administrer le compte.
 * Suppression du compte, révocation de sessions, export RGPD et confirmation d'un nouvel appairage
 * exigent une session de NAVIGATEUR (cookie + CSRF) et répondent 403
 * `{ code: 'browser_session_required' }` à un client natif.
 *
 * Deux critères, l'un OU l'autre suffit à refuser : le porteur `Authorization: Bearer`, et le
 * libellé de la session (`native-overlay`, recopié à chaque rotation) — sans le second, un jeton
 * d'overlay copié pourrait être présenté en cookie avec un `X-CSRF-Token` recalculé
 * (`sha256(jeton + ":csrf")`, dérivation publique) et passer pour une session de navigateur.
 *
 * Renvoie la réponse 403 à renvoyer telle quelle, ou `null` si l'appelant est un navigateur.
 */
export function rejectNativeCaller(auth: AuthenticatedContext): Response | null {
  if (!isNativeCaller(auth.via, auth.session)) return null;
  return json(
    { error: 'action réservée à une session de navigateur', code: 'browser_session_required' },
    403,
  );
}

/** 401 avec effacement des cookies d'authentification (jeton devenu inutilisable). */
export function unauthenticated(): Response {
  const headers = new Headers();
  for (const cookie of clearedAuthCookies()) headers.append('set-cookie', cookie);
  return jsonError('non authentifié', 401, headers);
}

/**
 * Contrôle CSRF double-submit sur les routes mutatives :
 * l'en-tête `X-CSRF-Token` doit correspondre au jeton dérivé de la session,
 * que le client récupère dans le cookie `wc_csrf` — seul un script de la même
 * origine peut le lire, là où le cookie de session, lui, serait envoyé
 * automatiquement par le navigateur depuis n'importe quel site.
 * `SameSite=Lax` reste la première barrière ; ceci est la seconde.
 *
 * ⚠ Aucun repli sur le cookie en l'absence d'en-tête : ce serait exactement
 * ce que la protection cherche à empêcher (le cookie voyage tout seul, pas
 * l'en-tête).
 *
 * **Exception porteur `Authorization: Bearer` (client natif)** — voir la doc de `authenticate` :
 * ce chemin n'est jamais envoyé automatiquement par un navigateur, donc rien à protéger contre un
 * site tiers. **Correctif du 2026-09-03** (retour utilisateur : overlay `wakfu-companion-overlay`,
 * historique jamais synchronisé) : cette exception était déjà DOCUMENTÉE ci-dessus depuis
 * l'introduction de l'appairage natif (lot L4) mais jamais câblée ici — les 3 endpoints mutatifs
 * (`/api/v1/history/{fights,purchases,trades}`) appelaient `requireCsrf` sans condition, donc
 * rejetaient systématiquement en 403 toute requête authentifiée par porteur, faute de
 * `X-CSRF-Token` (que ce client ne peut de toute façon pas produire : pas de cookie `wc_csrf`).
 */
export async function requireCsrf(request: Request, auth: AuthenticatedContext): Promise<boolean> {
  // Décidé sur la source EFFECTIVE de l'authentification (audit du 2026-09-23), jamais sur la
  // forme de l'en-tête : voir `server/auth/request-auth.ts`.
  if (isCsrfExempt(auth.via)) return true;
  return verifyCsrf(auth.sessionToken, request.headers.get('x-csrf-token'));
}
