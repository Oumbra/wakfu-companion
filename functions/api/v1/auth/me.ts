import type { PagesFunction } from '@cloudflare/workers-types';
import { CSRF_COOKIE, csrfCookie, readCookie } from '../../../../server/auth/cookies';
import { deriveCsrfToken } from '../../../../server/auth/flow';
import { authenticate, json, unauthenticated } from '../../_auth';
import type { Env } from '../../_types';

/**
 * GET /api/v1/auth/me — utilisateur courant, ou 401 si l'appelant n'est pas
 * connecté (lot 5, prompt 5.1).
 *
 * Un 401 ici est un cas NORMAL, pas une panne : c'est le mode invité, qui
 * doit rester pleinement fonctionnel (§7 du plan). Côté client, l'appel est
 * fait une fois au démarrage et un 401 fait simplement rester en invité.
 *
 * Effet de bord utile : la réponse repose le cookie CSRF si le navigateur l'a
 * perdu (durées de vie différentes, cookie non-`httpOnly` effaçable par
 * l'utilisateur) alors que la session, elle, est toujours valide.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();

  const identities = await auth.store.listIdentities(auth.user.id);

  const headers = new Headers();
  if (!readCookie(context.request, CSRF_COOKIE)) {
    headers.append('set-cookie', csrfCookie(await deriveCsrfToken(auth.sessionToken)));
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
