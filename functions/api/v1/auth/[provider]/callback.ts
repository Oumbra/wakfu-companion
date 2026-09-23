import type { PagesFunction } from '@cloudflare/workers-types';
import {
  clearedOauthStateCookies,
  readOauthStateCookie,
  readSessionCookie,
  sessionCookies,
} from '../../../../../server/auth/cookies';
import { sha256Hex } from '../../../../../server/auth/crypto';
import { completeAuthorization, sanitizeRedirectTo } from '../../../../../server/auth/flow';
import { fetchOAuthProfile, isProviderId, redirectUri } from '../../../../../server/auth/providers';
import { CALLBACK_RULE, checkRateLimit, clientIpKey } from '../../../../../server/auth/rate-limit';
import { authStore, jsonError, providerCredentials, publicBaseUrl } from '../../../_auth';
import type { Env } from '../../../_types';

/**
 * Construit la redirection de retour vers l'application. Le résultat est
 * toujours passé en paramètres d'URL (`login=ok|error`), jamais en JSON : le
 * navigateur arrive ici par une navigation classique depuis le fournisseur,
 * l'utilisateur doit atterrir dans l'application, pas sur une réponse d'API.
 */
function appRedirect(baseUrl: string, path: string | null, params: Record<string, string>): URL {
  const base = new URL(`${baseUrl}/`);
  // Défense en profondeur (audit du 2026-09-23) : `redirectTo` a déjà été filtré à l'écriture
  // (`startAuthorization`), mais une ligne écrite avant le correctif de `sanitizeRedirectTo`
  // peut encore être en base — on refiltre, et on vérifie l'origine obtenue.
  let url = new URL(sanitizeRedirectTo(path) ?? '/', base);
  if (url.origin !== base.origin) url = new URL('/', base);
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
  for (const cookie of clearedOauthStateCookies()) headers.append('set-cookie', cookie);

  const fail = (reason: string, status = 302): Response => {
    headers.set('location', appRedirect(baseUrl, null, { login: 'error', reason }).toString());
    return new Response(null, { status, headers });
  };

  const limit = await checkRateLimit(
    store,
    `auth:callback:ip:${await clientIpKey(context.request, context.env)}`,
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

  // Rotation à la connexion : une session déjà ouverte dans ce navigateur
  // est révoquée au profit de la nouvelle, plutôt que laissée active en
  // parallèle.
  const previousToken = readSessionCookie(context.request)?.token ?? null;

  const completion = await completeAuthorization(store, {
    provider: rawProvider,
    state: url.searchParams.get('state') ?? '',
    cookieState: readOauthStateCookie(context.request),
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

  if (!completion.ok) {
    // Un compte = un seul fournisseur : le fournisseur du compte existant voyage
    // dans `reason` pour que l'application dise avec lequel se reconnecter.
    if (completion.error === 'email_taken' && completion.existingProvider) {
      return fail(`email_taken_${completion.existingProvider}`);
    }
    return fail(completion.error);
  }

  const { result } = completion;
  // Nouveaux noms `__Host-`, ancien cookie de session effacé (voir cookies.ts, TRANSITION).
  for (const cookie of sessionCookies(result.token, result.csrfToken)) {
    headers.append('set-cookie', cookie);
  }
  headers.set(
    'location',
    appRedirect(baseUrl, result.redirectTo, {
      login: 'ok',
      ...(result.isNewUser ? { first: '1' } : {}),
    }).toString(),
  );
  return new Response(null, { status: 302, headers });
};
