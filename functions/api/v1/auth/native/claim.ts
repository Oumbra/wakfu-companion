import type { PagesFunction } from '@cloudflare/workers-types';
import { claimPairing } from '../../../../../server/auth/pairing';
import { PAIR_CLAIM_RULE, checkRateLimit, clientIp } from '../../../../../server/auth/rate-limit';
import { authenticate, json, jsonError, requireCsrf, unauthenticated } from '../../../_auth';
import type { Env } from '../../../_types';

const MAX_BODY_BYTES = 1024;

/**
 * POST /api/v1/auth/native/claim — confirme un appairage (page `/pair`, navigateur DÉJÀ connecté).
 * Authentifié + CSRF comme toute route mutative appelée par le navigateur (voir `_auth.ts`) : ce
 * n'est PAS le chemin natif (`poll.ts`), c'est l'utilisateur humain qui autorise depuis son compte.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();
  if (!(await requireCsrf(context.request, auth))) return jsonError('jeton CSRF invalide', 403);

  const limit = await checkRateLimit(
    auth.store,
    `auth:native-claim:ip:${clientIp(context.request)}`,
    PAIR_CLAIM_RULE,
    new Date(),
  );
  if (!limit.allowed) {
    return jsonError('trop de tentatives, réessayez plus tard', 429, {
      'retry-after': String(limit.retryAfterSeconds),
    });
  }

  const raw = await context.request.text();
  if (raw.length > MAX_BODY_BYTES) return jsonError('corps trop volumineux', 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError('corps JSON invalide', 400);
  }
  const pairingCode =
    typeof body === 'object' && body !== null && 'pairingCode' in body
      ? String((body as { pairingCode: unknown }).pairingCode)
      : null;
  if (!pairingCode) return jsonError('pairingCode manquant', 400);

  const claimed = await claimPairing(auth.store, {
    userCode: pairingCode.toUpperCase(),
    user: auth.user,
    now: new Date(),
  });
  if (!claimed) return jsonError('code invalide, expiré, ou déjà utilisé', 404);

  return json({ ok: true });
};
