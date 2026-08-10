import type { PagesFunction } from '@cloudflare/workers-types';
import {
  SESSION_COOKIE,
  clearedOauthStateCookie,
  csrfCookie,
  readCookie,
  sessionCookie,
  OAUTH_STATE_COOKIE,
} from '../../../../../server/auth/cookies';
import { sha256Hex } from '../../../../../server/auth/crypto';
import { completeAuthorization } from '../../../../../server/auth/flow';
import { fetchOAuthProfile, isProviderId, redirectUri } from '../../../../../server/auth/providers';
import { CALLBACK_RULE, checkRateLimit, clientIp } from '../../../../../server/auth/rate-limit';
import { authStore, jsonError, providerCredentials, publicBaseUrl } from '../../../_auth';
import type { Env } from '../../../_types';

/**
 * Construit la redirection de retour vers l'application. Le résultat est
 * toujours passé en paramètres d'URL (`login=ok|error`), jamais en JSON : le
 * navigateur arrive ici par une navigation classique depuis le fournisseur,
 * l'utilisateur doit atterrir dans l'application, pas sur une réponse d'API.
 */
function appRedirect(baseUrl: string, path: string | null, params: Record<string, string>): URL {
  const url = new URL(path ?? '/', `${baseUrl}/`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

/**
 * GET /api/v1/auth/{provider}/callback — retour du fournisseur (lot 5,
 * prompt 5.1).
 *
 * Le `code` est échangé CÔTÉ SERVEUR (le `client_secret` n'atteint jamais le
 * navigateur), après double validation du `state` : celui du cookie posé au
 * démarrage ET la ligne `oauth_authorizations`, consommée atomiquement — un
 * `state`/`code` rejoué est donc rejeté.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const rawProvider = String(context.params['provider'] ?? '');
  if (!isProviderId(rawProvider)) return jsonError('fournisseur inconnu', 404);

  const credentials = providerCredentials(context.env, rawProvider);
  if (!credentials) return jsonError(`fournisseur "${rawProvider}" non configuré`, 503);

  const baseUrl = publicBaseUrl(context.request, context.env);
  const url = new URL(context.request.url);
  const store = authStore(context.env);
  const now = new Date();

  const headers = new Headers({ 'cache-control': 'no-store' });
  headers.append('set-cookie', clearedOauthStateCookie());

  const fail = (reason: string, status = 302): Response => {
    headers.set('location', appRedirect(baseUrl, null, { login: 'error', reason }).toString());
    return new Response(null, { status, headers });
  };

  const limit = await checkRateLimit(
    store,
    `auth:callback:ip:${clientIp(context.request)}`,
    CALLBACK_RULE,
    now,
  );
  if (!limit.allowed) {
    headers.set('retry-after', String(limit.retryAfterSeconds));
    return fail('rate_limited');
  }

  // Refus explicite de l'utilisateur chez le fournisseur (« Annuler ») : ce
  // n'est pas une erreur technique, on revient simplement à l'application.
  const providerError = url.searchParams.get('error');
  if (providerError) return fail(providerError === 'access_denied' ? 'cancelled' : 'provider');

  const code = url.searchParams.get('code');
  if (!code) return fail('missing_code');

  // Rotation à la connexion (§7) : une session déjà ouverte dans ce navigateur
  // est révoquée au profit de la nouvelle, plutôt que laissée active en
  // parallèle.
  const previousToken = readCookie(context.request, SESSION_COOKIE);

  const completion = await completeAuthorization(store, {
    provider: rawProvider,
    state: url.searchParams.get('state') ?? '',
    cookieState: readCookie(context.request, OAUTH_STATE_COOKIE),
    now,
    userAgent: context.request.headers.get('user-agent'),
    currentSessionIdHash: previousToken ? await sha256Hex(previousToken) : null,
    fetchProfile: (codeVerifier) =>
      fetchOAuthProfile({
        provider: rawProvider,
        credentials,
        code,
        codeVerifier,
        redirectUri: redirectUri(baseUrl, rawProvider),
      }),
  });

  if (!completion.ok) return fail(completion.error);

  const { result } = completion;
  headers.append('set-cookie', sessionCookie(result.token));
  headers.append('set-cookie', csrfCookie(result.csrfToken));
  headers.set(
    'location',
    appRedirect(baseUrl, result.redirectTo, {
      login: 'ok',
      ...(result.isNewUser ? { first: '1' } : {}),
    }).toString(),
  );
  return new Response(null, { status: 302, headers });
};
