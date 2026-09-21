import { readCookie } from '../../server/auth/cookies';
import {
  APP_TOKEN_COOKIE,
  APP_TOKEN_REQUIRED_CODE,
  appTokenSecret,
  verifyAppToken,
} from '../../server/http/app-token';
import { isSameOriginRequest } from '../../server/http/caller';
import { authenticate, json, jsonError } from './_auth';
import type { Env } from './_types';

/**
 * Garde des routes « référentiel » (catalogue, objets, monstres, donjons, butins, relais d'icônes) :
 * `null` si l'appelant est l'un des deux clients du projet, sinon la réponse 403 à renvoyer telle
 * quelle. Voir `server/http/caller.ts` pour le pourquoi de la reconnaissance par `Sec-Fetch-Site`,
 * et `server/http/app-token.ts` pour le jeton d'application (2026-09-21, option B + C de
 * `docs/analyse-cgu-2026-09-21.md`, recommandation 4).
 *
 * Trois façons d'être reconnu, dans cet ordre :
 * 1. **le site** — `Sec-Fetch-Site: same-origin` ET cookie `wc_app` valide (jeton signé par le
 *    serveur, obtenu via `POST /api/v1/app/token` après vérification Turnstile). L'en-tête seul ne
 *    suffit plus : un client non navigateur l'écrit librement, le cookie, lui, ne s'obtient qu'en
 *    passant Turnstile. Pour le relais d'icônes (`appToken: false`), l'en-tête seul reste
 *    suffisant : une `<img>` peut partir avant que le jeton n'existe, et ces fichiers sont de toute
 *    façon publics sur wakassets — l'enjeu de non-redistribution porte sur les données ;
 * 2. **un appelant identifié** — session valide, en `Authorization: Bearer` (l'overlay) ou en
 *    cookie de session (un navigateur connecté, qui rejoue alors une requête sans attendre le
 *    jeton d'application) ;
 * 3. sinon 403 — avec le code `app_token_required` quand la requête vient bien du site mais sans
 *    jeton (absent, expiré, secret changé) : `ApiClientService` en redemande un et rejoue la
 *    requête une fois. Tout autre appelant reçoit un 403 sans indication.
 */
export async function rejectUnknownCaller(
  request: Request,
  env: Env,
  options: { appToken: boolean } = { appToken: true },
): Promise<Response | null> {
  const sameOrigin = isSameOriginRequest(request.headers);
  if (sameOrigin) {
    if (!options.appToken) return null;
    const cookie = readCookie(request, APP_TOKEN_COOKIE);
    if (await verifyAppToken(appTokenSecret(env), cookie, Date.now())) return null;
  }
  if ((await authenticate(request, env)) !== null) return null;
  if (sameOrigin) {
    return json({ error: 'jeton d’application requis', code: APP_TOKEN_REQUIRED_CODE }, 403);
  }
  return jsonError('appelant non autorisé', 403);
}
