import type { PagesFunction } from '@cloudflare/workers-types';
import { clearedAuthCookies } from '../../../../server/auth/cookies';
import { SESSION_RULE, checkRateLimit, clientIp } from '../../../../server/auth/rate-limit';
import { authenticate, json, jsonError, requireCsrf, unauthenticated } from '../../_auth';
import type { Env } from '../../_types';

/**
 * GET /api/v1/auth/sessions — sessions actives du compte (lot 5, prompt 5.1).
 *
 * `id` renvoyé est l'empreinte SHA-256 stockée en base, pas le jeton (qui
 * n'existe que dans le cookie du navigateur concerné) : il sert uniquement à
 * désigner une session à révoquer depuis la page compte. Connaître cette
 * empreinte ne permet donc pas d'usurper la session.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();

  const sessions = await auth.store.listSessions(auth.user.id, new Date());
  return json({
    sessions: sessions
      .map((session) => ({
        id: session.idHash,
        current: session.idHash === auth.sessionIdHash,
        issuedAt: session.issuedAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        userAgent: session.userAgent,
      }))
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt)),
  });
};

/**
 * DELETE /api/v1/auth/sessions — révocation.
 *
 * - `?id=<empreinte>` : révoque cette session précise ;
 * - sans paramètre : révoque TOUTES les sessions du compte, y compris la
 *   courante (« déconnecter tous mes appareils »), et efface donc les cookies
 *   de l'appelant.
 */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
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

  const targetId = new URL(context.request.url).searchParams.get('id');

  if (targetId) {
    // On ne révoque que parmi SES propres sessions : la liste est filtrée par
    // user_id avant toute écriture, une empreinte appartenant à un autre
    // compte ne matche simplement pas.
    const own = await auth.store.listSessions(auth.user.id, now);
    if (!own.some((session) => session.idHash === targetId)) {
      return jsonError('session inconnue', 404);
    }
    await auth.store.revokeSession(targetId, now);

    const headers = new Headers();
    if (targetId === auth.sessionIdHash) {
      for (const cookie of clearedAuthCookies()) headers.append('set-cookie', cookie);
    }
    return json({ revoked: 1, loggedOut: targetId === auth.sessionIdHash }, 200, headers);
  }

  const revoked = await auth.store.revokeAllSessions(auth.user.id, now);
  const headers = new Headers();
  for (const cookie of clearedAuthCookies()) headers.append('set-cookie', cookie);
  return json({ revoked, loggedOut: true }, 200, headers);
};
