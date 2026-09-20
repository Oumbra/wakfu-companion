import { isSameOriginRequest } from '../../server/http/caller';
import { authenticate, jsonError } from './_auth';
import type { Env } from './_types';

/**
 * Garde des routes « référentiel » (catalogue, objets, monstres, donjons, relais d'icônes) : `null`
 * si l'appelant est l'un des deux clients du projet, sinon la réponse 403 à renvoyer telle quelle.
 * Voir `server/http/caller.ts` pour le pourquoi.
 *
 * Deux signatures, et seulement deux : `Sec-Fetch-Site: same-origin` pour le site (un en-tête,
 * synchrone, vérifié en premier), sinon une session valide en `Authorization: Bearer` pour
 * l'overlay (un SELECT, `authenticate`). Un cookie de session du navigateur passe par là aussi,
 * sans conséquence : un navigateur connecté est déjà reconnu comme site par son en-tête.
 */
export async function rejectUnknownCaller(request: Request, env: Env): Promise<Response | null> {
  if (isSameOriginRequest(request.headers)) return null;
  if ((await authenticate(request, env)) !== null) return null;
  return jsonError('appelant non autorisé', 403);
}
