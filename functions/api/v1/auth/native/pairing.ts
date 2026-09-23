import type { PagesFunction } from '@cloudflare/workers-types';
import { findPendingPairingInfo, normalizeUserCode } from '../../../../../server/auth/pairing';
import { PAIR_INFO_RULE, checkRateLimit } from '../../../../../server/auth/rate-limit';
import { authenticate, json, jsonError, rejectNativeCaller, unauthenticated } from '../../../_auth';
import type { Env } from '../../../_types';

/**
 * GET /api/v1/auth/native/pairing?code=<pairingCode> — ce que la page `/pair` montre d'une demande
 * d'appairage AVANT que l'utilisateur ne la confirme (audit de sécurité du 2026-09-23).
 *
 * Pourquoi : l'appairage par code est un « device flow », dont l'attaque classique est
 * l'hameçonnage — un tiers lance l'appairage sur SA machine et envoie le lien `/pair?code=…` à sa
 * victime, qui confirme de bonne foi et lui remet un jeton sur son compte. Afficher l'âge de la
 * demande, le pays et le navigateur/l'appareil qui l'a émise donne à l'utilisateur de quoi repérer
 * une demande qui ne vient pas de lui.
 *
 * Contrat :
 * - authentifié par une session de NAVIGATEUR (cookie) — 401 sinon, 403
 *   `browser_session_required` pour un jeton d'overlay ;
 * - `code` : le code d'appairage (casse indifférente), 400 s'il est absent ou hors format ;
 * - 200 `{ pairingCode, requestedAt, ageSeconds, expiresAt, expiresInSeconds, country, userAgent }`
 *   (dates ISO 8601 ; `country` = code pays ISO à deux lettres Cloudflare — `XX` inconnu, `T1`
 *   Tor — ou `null` ; `userAgent` tronqué à 200 caractères ou `null`) ;
 * - 404 si la demande est inconnue, expirée ou déjà confirmée ;
 * - 429 au-delà de `PAIR_INFO_RULE` (30 consultations / 10 min par compte : borne l'énumération).
 *
 * Lecture seule : pas de CSRF. Jamais le `pollToken` dans la réponse.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();
  const nativeRejection = rejectNativeCaller(auth);
  if (nativeRejection) return nativeRejection;

  const rawCode = new URL(context.request.url).searchParams.get('code');
  if (!rawCode) return jsonError('code manquant', 400);
  const code = normalizeUserCode(rawCode);
  if (!code) return jsonError('code invalide', 400);

  const now = new Date();
  const limit = await checkRateLimit(
    auth.store,
    `auth:native-pairing-info:user:${auth.user.id}`,
    PAIR_INFO_RULE,
    now,
  );
  if (!limit.allowed) {
    return jsonError('trop de requêtes', 429, { 'retry-after': String(limit.retryAfterSeconds) });
  }

  const info = await findPendingPairingInfo(auth.store, code, now);
  if (!info) return jsonError('code invalide, expiré, ou déjà utilisé', 404);

  return json({
    pairingCode: info.pairingCode,
    requestedAt: info.requestedAt.toISOString(),
    ageSeconds: info.ageSeconds,
    expiresAt: info.expiresAt.toISOString(),
    expiresInSeconds: info.expiresInSeconds,
    country: info.country,
    userAgent: info.userAgent,
  });
};
