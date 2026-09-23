import type { PagesFunction } from '@cloudflare/workers-types';
import { readBodyLimited } from '../../../../server/http/body';
import { readCookie } from '../../../../server/auth/cookies';
import {
  APP_TOKEN_COOKIE,
  APP_TOKEN_TTL_MS,
  appTokenCookie,
  appTokenSecret,
  signAppToken,
  verifyAppToken,
} from '../../../../server/http/app-token';
import { APP_TOKEN_RULE, checkRateLimit, clientIpKey } from '../../../../server/auth/rate-limit';
import { isSameOriginRequest } from '../../../../server/http/caller';
import { turnstileMode, verifyTurnstileToken } from '../../../../server/http/turnstile';
import { isPublicDeployment } from '../../../../server/auth/environment';
import { authStore, json, jsonError, publicBaseUrl } from '../../_auth';
import type { Env } from '../../_types';

/**
 * Jeton d'application du site (`docs/analyse-cgu-2026-09-21.md`, recommandation 4, options B + C ;
 * voir `server/http/app-token.ts` pour le pourquoi et la forme du jeton).
 *
 * - `GET /api/v1/app/token` — configuration publique : `{ siteKey, ttlSeconds, hasToken }`.
 *   `siteKey` est la clé de site Turnstile (publique par nature) ou `null` quand Turnstile n'est
 *   pas configuré sur cet environnement (`TURNSTILE_SITE_KEY` absent) ; `hasToken` dit si le
 *   cookie porté par cette requête est encore valide — le client s'en sert au démarrage.
 * - `POST /api/v1/app/token` — corps `{ turnstileToken }` ; vérifie le jeton Turnstile auprès de
 *   `siteverify` quand `TURNSTILE_SECRET_KEY` est configuré (403 `turnstile_failed` sinon), puis
 *   pose le cookie `wc_app` et répond `{ ok: true, expiresAt }`.
 *
 * Les deux verbes exigent `Sec-Fetch-Site: same-origin` : le jeton n'est destiné qu'au site
 * lui-même (l'overlay a sa session `Bearer`). Le `POST` est limité par IP (`APP_TOKEN_RULE`,
 * 20 par 10 min, même mécanisme en base que les routes `/auth/*` — voir
 * `server/auth/rate-limit.ts`) : c'est la seule écriture de la route, et elle borne le coût
 * `siteverify` et le « farming » de cookies d'un appelant abusif, sans dépendre d'un réglage de
 * périphérie Cloudflare (le rate limiting de zone n'est pas disponible sur le plan du projet). Un
 * jeton Turnstile est de toute façon à usage unique : un automate n'en obtient pas gratuitement.
 *
 * Turnstile non configuré (ni clé de site ni secret) : en développement local SEULEMENT, le jeton
 * est émis sans vérification (`wrangler pages dev` sans `.dev.vars` dédié doit rester utilisable).
 * Sur un déploiement public (https hors localhost, `server/auth/environment.ts`), c'est un 503
 * `turnstile_unavailable` — de même que le secret de test Cloudflare (`1x…`, réussit toujours) et
 * qu'une clé de site sans secret (ou l'inverse) partout : fail-closed, audit du 2026-09-23 (voir
 * `turnstileMode`). Même principe pour le secret HMAC : sans `APP_TOKEN_SECRET` en production, pas
 * de repli sur `DATABASE_URL`, 503 explicite.
 */

const MAX_BODY_BYTES = 4096;

function notSameOrigin(): Response {
  return jsonError('appelant non autorisé', 403);
}

/** Noms d'hôte (sans port) admis pour le `hostname` renvoyé par `siteverify` : l'origine publique
 * déclarée (`PUBLIC_BASE_URL`, prod ou preview stable) et l'hôte réellement servi (URL par
 * déploiement d'une preview, `localhost` en développement). Le domaine du widget Turnstile borne
 * de toute façon où un jeton peut être obtenu. */
function expectedHostnames(request: Request, env: Env): Set<string> {
  const hosts = new Set<string>();
  for (const candidate of [publicBaseUrl(request, env), request.url]) {
    try {
      hosts.add(new URL(candidate).hostname);
    } catch {
      // origine mal formée : ignorée, l'autre candidate suffit
    }
  }
  return hosts;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  if (!isSameOriginRequest(context.request.headers)) return notSameOrigin();
  const secret = appTokenSecret(context.env, context.request.url);
  const hasToken = await verifyAppToken(
    secret,
    readCookie(context.request, APP_TOKEN_COOKIE),
    Date.now(),
  );
  return json({
    siteKey: context.env.TURNSTILE_SITE_KEY || null,
    ttlSeconds: Math.floor(APP_TOKEN_TTL_MS / 1000),
    hasToken,
  });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  if (!isSameOriginRequest(context.request.headers)) return notSameOrigin();

  const limit = await checkRateLimit(
    authStore(context.env),
    `app:token:ip:${await clientIpKey(context.request, context.env)}`,
    APP_TOKEN_RULE,
    new Date(),
  );
  if (!limit.allowed) {
    return jsonError('trop de demandes de jeton, réessayez plus tard', 429, {
      'retry-after': String(limit.retryAfterSeconds),
    });
  }

  const turnstileSecret = context.env.TURNSTILE_SECRET_KEY || null;
  const mode = turnstileMode({
    siteKey: context.env.TURNSTILE_SITE_KEY,
    secret: turnstileSecret,
    publicDeployment: isPublicDeployment(context.env, context.request.url),
  });
  if (mode === 'misconfigured') {
    return json(
      {
        error:
          'Turnstile non configuré pour ce déploiement (clé de site + secret réel requis en production)',
        code: 'turnstile_unavailable',
      },
      503,
    );
  }

  const read = await readBodyLimited(context.request, MAX_BODY_BYTES);
  if (!read.ok) return jsonError(read.error, read.status);
  const raw = read.text;
  let body: unknown = null;
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonError('corps JSON invalide', 400);
    }
  }
  const turnstileToken =
    typeof body === 'object' && body !== null && 'turnstileToken' in body
      ? (body as { turnstileToken: unknown }).turnstileToken
      : null;

  if (mode === 'verify' && turnstileSecret !== null) {
    const verification = await verifyTurnstileToken({
      secret: turnstileSecret,
      token: turnstileToken,
      remoteIp: context.request.headers.get('cf-connecting-ip'),
      expectedHostnames: expectedHostnames(context.request, context.env),
    });
    if (!verification.ok) {
      return json(
        {
          error: 'vérification Turnstile refusée',
          code: 'turnstile_failed',
          reason: verification.reason,
        },
        403,
      );
    }
  }

  const secret = appTokenSecret(context.env, context.request.url);
  if (!secret) {
    return jsonError('jeton d’application non configuré (APP_TOKEN_SECRET manquant)', 503);
  }
  const now = Date.now();
  const token = await signAppToken(secret, now);
  const headers = new Headers();
  headers.append('set-cookie', appTokenCookie(token));
  return json(
    { ok: true, expiresAt: new Date(now + APP_TOKEN_TTL_MS).toISOString() },
    200,
    headers,
  );
};
