import type { PagesFunction } from '@cloudflare/workers-types';
import { pollPairing } from '../../../../../server/auth/pairing';
import { PAIR_POLL_RULE, checkRateLimit } from '../../../../../server/auth/rate-limit';
import { authStore, json, jsonError } from '../../../_auth';
import type { Env } from '../../../_types';

const MAX_BODY_BYTES = 1024;

/**
 * POST /api/v1/auth/native/poll — sondage par l'overlay (pas d'authentification : c'est justement
 * ce que cette route sert à obtenir). Rate-limité par `pollToken` lui-même plutôt que par IP : le
 * secret sert de clé naturelle, et c'est un sondage légitime à rythme régulier (~3 s) tant que
 * l'appairage n'a pas expiré côté serveur.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const raw = await context.request.text();
  if (raw.length > MAX_BODY_BYTES) return jsonError('corps trop volumineux', 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError('corps JSON invalide', 400);
  }
  const pollToken =
    typeof body === 'object' && body !== null && 'pollToken' in body
      ? String((body as { pollToken: unknown }).pollToken)
      : null;
  if (!pollToken) return jsonError('pollToken manquant', 400);

  const store = authStore(context.env);
  const now = new Date();

  const limit = await checkRateLimit(store, `auth:native-poll:${pollToken}`, PAIR_POLL_RULE, now);
  if (!limit.allowed) {
    return jsonError('sondage trop fréquent', 429, {
      'retry-after': String(limit.retryAfterSeconds),
    });
  }

  const result = await pollPairing(store, pollToken, now);
  return json(result);
};
