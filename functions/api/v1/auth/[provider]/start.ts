import type { PagesFunction } from '@cloudflare/workers-types';
import { oauthStateCookie } from '../../../../../server/auth/cookies';
import { startAuthorization } from '../../../../../server/auth/flow';
import { buildAuthorizeUrl, isProviderId, redirectUri } from '../../../../../server/auth/providers';
import { START_RULE, checkRateLimit, clientIp } from '../../../../../server/auth/rate-limit';
import { authStore, jsonError, providerCredentials, publicBaseUrl } from '../../../_auth';
import type { Env } from '../../../_types';

/**
 * GET /api/v1/auth/{provider}/start — démarre le flux OAuth (lot 5, prompt
 * 5.1) : crée une autorisation en attente (`state` + `code_verifier` PKCE,
 * stockés en base, jamais côté navigateur pour le verifier) et redirige vers
 * le fournisseur.
 *
 * `?redirect_to=` permet de revenir à la vue d'origine après connexion ;
 * seuls les chemins internes sont acceptés (voir `sanitizeRedirectTo` — une
 * URL absolue ferait de cette route une redirection ouverte).
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const rawProvider = String(context.params['provider'] ?? '');
  if (!isProviderId(rawProvider)) return jsonError('fournisseur inconnu', 404);

  const credentials = providerCredentials(context.env, rawProvider);
  if (!credentials) return jsonError(`fournisseur "${rawProvider}" non configuré`, 503);

  const store = authStore(context.env);
  const now = new Date();

  const limit = await checkRateLimit(
    store,
    `auth:start:ip:${clientIp(context.request)}`,
    START_RULE,
    now,
  );
  if (!limit.allowed) {
    return jsonError('trop de tentatives de connexion, réessayez plus tard', 429, {
      'retry-after': String(limit.retryAfterSeconds),
    });
  }

  const url = new URL(context.request.url);
  const { state, codeChallenge } = await startAuthorization(store, {
    provider: rawProvider,
    redirectTo: url.searchParams.get('redirect_to'),
    now,
  });

  const authorizeUrl = buildAuthorizeUrl({
    provider: rawProvider,
    clientId: credentials.clientId,
    redirectUri: redirectUri(publicBaseUrl(context.request, context.env), rawProvider),
    state,
    codeChallenge,
  });

  const headers = new Headers({ location: authorizeUrl, 'cache-control': 'no-store' });
  headers.append('set-cookie', oauthStateCookie(state));
  return new Response(null, { status: 302, headers });
};
