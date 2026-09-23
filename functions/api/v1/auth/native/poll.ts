import type { PagesFunction } from '@cloudflare/workers-types';
import { readBodyLimited } from '../../../../../server/http/body';
import { isWellFormedPollToken, pollPairing } from '../../../../../server/auth/pairing';
import {
  PAIR_POLL_IP_RULE,
  PAIR_POLL_RULE,
  checkRateLimit,
  clientIpKey,
  pollTokenBucket,
} from '../../../../../server/auth/rate-limit';
import { authStore, json, jsonError } from '../../../_auth';
import type { Env } from '../../../_types';

const MAX_BODY_BYTES = 1024;

/**
 * POST /api/v1/auth/native/poll — sondage par l'overlay (pas d'authentification : c'est justement
 * ce que cette route sert à obtenir). C'est un sondage légitime à rythme régulier (~3 s) tant que
 * l'appairage n'a pas expiré côté serveur.
 *
 * Durcissement (audit du 2026-09-23) :
 * 1. un `pollToken` hors format (43 caractères base64url, `randomToken()` de 32 octets) est refusé
 *    d'emblée (400), sans toucher la base ;
 * 2. limitation par IP (`PAIR_POLL_IP_RULE`) AVANT la limitation par jeton : faire varier le jeton
 *    ne donne plus un compteur neuf à chaque essai ;
 * 3. la limitation par jeton compte sur son EMPREINTE (`pollTokenBucket`) : le `pollToken` est un
 *    secret (il vaut le jeton de session une fois l'appairage confirmé), il n'a rien à faire en
 *    clair dans `auth_rate_limits`.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const read = await readBodyLimited(context.request, MAX_BODY_BYTES);
  if (!read.ok) return jsonError(read.error, read.status);
  const raw = read.text;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError('corps JSON invalide', 400);
  }
  const pollToken =
    typeof body === 'object' && body !== null && 'pollToken' in body
      ? (body as { pollToken: unknown }).pollToken
      : null;
  if (pollToken === null || pollToken === undefined || pollToken === '') {
    return jsonError('pollToken manquant', 400);
  }
  if (typeof pollToken !== 'string' || !isWellFormedPollToken(pollToken)) {
    return jsonError('pollToken invalide', 400);
  }

  const store = authStore(context.env);
  const now = new Date();

  const ipLimit = await checkRateLimit(
    store,
    `auth:native-poll:ip:${await clientIpKey(context.request, context.env)}`,
    PAIR_POLL_IP_RULE,
    now,
  );
  if (!ipLimit.allowed) {
    return jsonError('sondage trop fréquent', 429, {
      'retry-after': String(ipLimit.retryAfterSeconds),
    });
  }

  const limit = await checkRateLimit(store, await pollTokenBucket(pollToken), PAIR_POLL_RULE, now);
  if (!limit.allowed) {
    return jsonError('sondage trop fréquent', 429, {
      'retry-after': String(limit.retryAfterSeconds),
    });
  }

  const result = await pollPairing(store, pollToken, now);
  return json(result);
};
