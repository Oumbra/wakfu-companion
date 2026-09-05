import type { PagesFunction } from '@cloudflare/workers-types';
import { startPairing } from '../../../../../server/auth/pairing';
import { PAIR_RULE, checkRateLimit, clientIp } from '../../../../../server/auth/rate-limit';
import { authStore, json, jsonError, publicBaseUrl } from '../../../_auth';
import type { Env } from '../../../_types';

/**
 * POST /api/v1/auth/native/pair — démarre un appairage de client natif (overlay), lot L4 de
 * `wakfu-companion-overlay` (`docs/plan-architecture.md` §7.2 de ce dépôt). Pas d'authentification
 * ici : c'est justement ce que cette route sert à obtenir — voir `claim.ts`/`poll.ts`.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const store = authStore(context.env);
  const now = new Date();

  const limit = await checkRateLimit(
    store,
    `auth:native-pair:ip:${clientIp(context.request)}`,
    PAIR_RULE,
    now,
  );
  if (!limit.allowed) {
    return jsonError('trop de tentatives, réessayez plus tard', 429, {
      'retry-after': String(limit.retryAfterSeconds),
    });
  }

  const pairing = await startPairing(store, now);
  const baseUrl = publicBaseUrl(context.request, context.env);

  return json({
    pairingCode: pairing.userCode,
    pollToken: pairing.deviceCode,
    verificationUrl: `${baseUrl}/pair?code=${pairing.userCode}`,
    expiresInSeconds: Math.floor((pairing.expiresAt.getTime() - now.getTime()) / 1000),
  });
};
