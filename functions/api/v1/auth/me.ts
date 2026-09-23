import type { PagesFunction } from '@cloudflare/workers-types';
import { csrfCookies, hasCsrfCookie, sessionCookies } from '../../../../server/auth/cookies';
import { deriveCsrfToken } from '../../../../server/auth/flow';
import { authenticate, json, unauthenticated } from '../../_auth';
import type { Env } from '../../_types';

/**
 * GET /api/v1/auth/me — utilisateur courant, ou 401 si l'appelant n'est pas
 * connecté (lot 5, prompt 5.1).
 *
 * Un 401 ici est un cas NORMAL, pas une panne : c'est le mode invité, qui
 * doit rester pleinement fonctionnel. Côté client, l'appel est fait une fois
 * au démarrage et un 401 fait simplement rester en invité.
 *
 * Effets de bord utiles (navigateur uniquement — jamais de cookie pour un porteur natif) :
 * - la réponse repose le cookie CSRF si le navigateur l'a perdu (durées de vie
 *   différentes, cookie non-`httpOnly` effaçable par l'utilisateur) alors que la
 *   session, elle, est toujours valide ;
 * - **migration des noms de cookie** (audit du 2026-09-23, préfixe `__Host-`) : une
 *   session encore portée par l'ancien cookie `wc_session` est réécrite sous
 *   `__Host-wc_session` (même jeton, pas de reconnexion), le CSRF aussi, et l'ancien
 *   cookie est effacé. Appelée à chaque démarrage du site, cette route suffit à
 *   faire basculer tous les navigateurs actifs (voir `LEGACY_*`, cookies.ts).
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();

  const identities = await auth.store.listIdentities(auth.user.id);

  const headers = new Headers();
  if (auth.via === 'cookie') {
    const csrfToken = await deriveCsrfToken(auth.sessionToken);
    if (auth.legacyCookie) {
      for (const cookie of sessionCookies(auth.sessionToken, csrfToken)) {
        headers.append('set-cookie', cookie);
      }
    } else if (!hasCsrfCookie(context.request)) {
      for (const cookie of csrfCookies(csrfToken)) headers.append('set-cookie', cookie);
    }
  }

  return json(
    {
      user: {
        id: auth.user.id,
        email: auth.user.email,
        displayName: auth.user.displayName,
      },
      identities: identities.map((identity) => ({
        provider: identity.provider,
        linkedAt: identity.linkedAt.toISOString(),
      })),
    },
    200,
    headers,
  );
};
