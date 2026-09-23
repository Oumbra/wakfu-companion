import type { PagesFunction } from '@cloudflare/workers-types';
import { readBodyLimited } from '../../../../../server/http/body';
import { claimPairing, normalizeUserCode } from '../../../../../server/auth/pairing';
import {
  PAIR_CLAIM_RULE,
  checkRateLimit,
  clientIpKey,
} from '../../../../../server/auth/rate-limit';
import {
  authenticate,
  json,
  jsonError,
  rejectNativeCaller,
  requireCsrf,
  unauthenticated,
} from '../../../_auth';
import type { Env } from '../../../_types';

const MAX_BODY_BYTES = 1024;

/**
 * POST /api/v1/auth/native/claim — confirme un appairage (page `/pair`, navigateur DÉJÀ connecté).
 * Authentifié + CSRF comme toute route mutative appelée par le navigateur (voir `_auth.ts`) : ce
 * n'est PAS le chemin natif (`poll.ts`), c'est l'utilisateur humain qui autorise depuis son compte.
 *
 * Session de navigateur exigée (audit du 2026-09-23) : un jeton d'overlay ne peut pas confirmer
 * d'autres appairages — sans quoi un seul jeton volé suffirait à en engendrer indéfiniment
 * (chacun avec sa propre durée de vie). 403 `browser_session_required`, voir `rejectNativeCaller`.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();
  const nativeRejection = rejectNativeCaller(auth);
  if (nativeRejection) return nativeRejection;
  if (!(await requireCsrf(context.request, auth))) return jsonError('jeton CSRF invalide', 403);

  const limit = await checkRateLimit(
    auth.store,
    `auth:native-claim:ip:${await clientIpKey(context.request, context.env)}`,
    PAIR_CLAIM_RULE,
    new Date(),
  );
  if (!limit.allowed) {
    return jsonError('trop de tentatives, réessayez plus tard', 429, {
      'retry-after': String(limit.retryAfterSeconds),
    });
  }

  const read = await readBodyLimited(context.request, MAX_BODY_BYTES);
  if (!read.ok) return jsonError(read.error, read.status);
  const raw = read.text;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError('corps JSON invalide', 400);
  }
  const rawCode =
    typeof body === 'object' && body !== null && 'pairingCode' in body
      ? (body as { pairingCode: unknown }).pairingCode
      : null;
  if (rawCode === null || rawCode === undefined || rawCode === '') {
    return jsonError('pairingCode manquant', 400);
  }
  // Un code hors alphabet/longueur n'a pas pu être émis ici : même réponse qu'un code inconnu.
  const pairingCode = normalizeUserCode(rawCode);
  if (!pairingCode) return jsonError('code invalide, expiré, ou déjà utilisé', 404);

  const claimed = await claimPairing(auth.store, {
    userCode: pairingCode,
    user: auth.user,
    now: new Date(),
  });
  if (!claimed) return jsonError('code invalide, expiré, ou déjà utilisé', 404);

  return json({ ok: true });
};
