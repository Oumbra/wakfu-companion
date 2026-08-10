import type { PagesFunction } from '@cloudflare/workers-types';
import { clearedAuthCookies } from '../../../../server/auth/cookies';
import { SESSION_RULE, checkRateLimit, clientIp } from '../../../../server/auth/rate-limit';
import { authenticate, json, jsonError, requireCsrf, unauthenticated } from '../../_auth';
import type { Env } from '../../_types';

/**
 * POST /api/v1/auth/logout — révoque la session courante (lot 5, prompt 5.1).
 *
 * La révocation est côté serveur (table `sessions`), pas seulement un
 * effacement de cookie : un jeton volé avant la déconnexion cesse d'être
 * utilisable — c'est précisément ce qu'un JWT autoporteur ne permettrait pas
 * (§7 du plan).
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();

  if (!(await requireCsrf(context.request, auth))) return jsonError('jeton CSRF invalide', 403);

  const now = new Date();
  const limit = await checkRateLimit(
    auth.store,
    `auth:session:ip:${clientIp(context.request)}`,
    SESSION_RULE,
    now,
  );
  if (!limit.allowed) {
    return jsonError('trop de requêtes', 429, { 'retry-after': String(limit.retryAfterSeconds) });
  }

  await auth.store.revokeSession(auth.sessionIdHash, now);

  const headers = new Headers();
  for (const cookie of clearedAuthCookies()) headers.append('set-cookie', cookie);
  return json({ ok: true }, 200, headers);
};
