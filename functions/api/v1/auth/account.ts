import type { PagesFunction } from '@cloudflare/workers-types';
import { clearedAuthCookies } from '../../../../server/auth/cookies';
import { SESSION_RULE, checkRateLimit } from '../../../../server/auth/rate-limit';
import { authenticate, json, jsonError, requireCsrf, unauthenticated } from '../../_auth';
import type { Env } from '../../_types';

/**
 * DELETE /api/v1/auth/account — suppression du compte, exigée par le RGPD
 * (§7 du plan : « suppression du compte avec effet réel »).
 *
 * Suppression réelle de la ligne `users` : identités, sessions et — à partir
 * du lot 6 — configuration et historiques partent en cascade
 * (`ON DELETE CASCADE` posé dès le schéma). Aucune conservation « au cas où »,
 * aucun marquage logique.
 *
 * Les données locales du navigateur ne sont PAS concernées : elles n'ont
 * jamais quitté la machine de l'utilisateur en mode invité, et le client
 * propose son propre effacement (page profil, déjà existante).
 */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();

  if (!(await requireCsrf(context.request, auth))) return jsonError('jeton CSRF invalide', 403);

  const now = new Date();
  const limit = await checkRateLimit(
    auth.store,
    `auth:session:user:${auth.user.id}`,
    SESSION_RULE,
    now,
  );
  if (!limit.allowed) {
    return jsonError('trop de requêtes', 429, { 'retry-after': String(limit.retryAfterSeconds) });
  }

  await auth.store.deleteUser(auth.user.id);

  const headers = new Headers();
  for (const cookie of clearedAuthCookies()) headers.append('set-cookie', cookie);
  return json({ deleted: true }, 200, headers);
};
