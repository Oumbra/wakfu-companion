import { identifyCaller } from '../../server/http/caller';
import { authenticate, jsonError } from './_auth';
import type { Env } from './_types';

/**
 * Garde des routes « référentiel » (catalogue, objets, monstres, donjons, relais d'icônes) : `null`
 * si l'appelant est l'un des deux clients du projet, sinon la réponse 403 à renvoyer telle quelle.
 * Voir `server/http/caller.ts` pour le pourquoi et les signatures reconnues.
 *
 * Ordre des vérifications, du moins cher au plus cher : les en-têtes seuls (`identifyCaller`,
 * synchrone) couvrent le site et, en transition, l'overlay par `User-Agent` ; à défaut, une session
 * valide portée en `Authorization: Bearer` (un SELECT, `authenticate`) — c'est la signature cible
 * de l'overlay, appairé obligatoirement depuis le 2026-09-14, dès qu'il enverra son jeton sur ces
 * routes. Un cookie de session du navigateur passe par là aussi, sans conséquence : un navigateur
 * connecté est déjà reconnu comme « site » par ses en-têtes.
 */
export async function rejectUnknownCaller(request: Request, env: Env): Promise<Response | null> {
  if (identifyCaller(request.headers, request.url) !== null) return null;
  if ((await authenticate(request, env)) !== null) return null;
  return jsonError('appelant non autorisé', 403);
}
