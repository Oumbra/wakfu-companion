import type { PagesFunction } from '@cloudflare/workers-types';
import { runRetentionPurges, sessionChainId } from '../../../../../server/auth/flow';
import {
  NativeRotationConflictError,
  isNativeSession,
  rotateNativeSession,
} from '../../../../../server/auth/pairing';
import { readRequestCredential } from '../../../../../server/auth/request-auth';
import { SESSION_RULE, checkRateLimit, clientIpKey } from '../../../../../server/auth/rate-limit';
import { authenticate, json, jsonError, unauthenticated } from '../../../_auth';
import type { AuthenticatedContext } from '../../../_auth';
import type { Env } from '../../../_types';

/**
 * Session du client natif (overlay) : `POST` la renouvelle, `DELETE` l'efface. Les deux verbes
 * exigent le porteur `Authorization: Bearer` (voir « Porteur obligatoire » plus bas) et
 * s'appliquent à la session qui porte la requête — il n'y a rien à désigner.
 *
 * ## POST /api/v1/auth/native/session — rotation du jeton
 *
 * Réponse `{ token, issuedAt, expiresAt, previousTokenValidUntil }` : un jeton neuf de 30 jours
 * glissants, et la date jusqu'à laquelle l'ancien reste accepté
 * (`NATIVE_SESSION_ROTATION_GRACE_MS` après l'appel). L'overlay persiste le nouveau jeton PUIS
 * bascule ; les requêtes déjà parties avec l'ancien aboutissent. Toute la sémantique (session
 * remplacée, grâce non prolongeable, cas du plantage entre réponse et écriture) est dans
 * `server/auth/pairing.ts::rotateNativeSession` — dont, depuis l'audit du 2026-09-23, le plafond
 * de 180 jours propagé d'une rotation à l'autre et le rattrapage depuis un jeton déjà remplacé
 * admis UNE fois (une seconde fois : chaîne révoquée, 401). Le rythme est laissé à l'overlay : le serveur ne
 * force jamais une rotation, un jeton non renouvelé reste simplement un jeton de 30 jours
 * glissants comme avant.
 *
 * ## DELETE /api/v1/auth/native/session — **le client natif efface sa session côté serveur**
 * (demande utilisateur du 2026-09-18, constat C5 de `docs/analyse-rgpd.md` du dépôt
 * `wakfu-companion-overlay`).
 *
 * L'overlay savait effacer le jeton de SA machine, et rien de plus : le jeton restait valide en
 * base, donc utilisable par qui en aurait pris copie avant. C'est ce que cette route ferme. Elle
 * est appelée à chaque déconnexion et par « Supprimer les données locales ».
 *
 * ## Pourquoi une route de plus, alors que `/api/v1/auth/logout` existe
 *
 * `logout` **révoque** : la ligne reste en base avec son `revoked_at`, et la réponse efface les
 * cookies du navigateur. C'est le bon geste pour une session de navigateur — la trace documente
 * qu'un appareil s'est déconnecté, et le jeton est déjà inutilisable.
 *
 * Celle-ci **efface** ([`AuthStore.deleteSession`]) : la ligne disparaît, avec ses horodatages et
 * son `user_agent`. C'est ce que demande l'effacement des données de l'overlay, qui ne s'arrête pas
 * au jeton ; et il n'y a pas de cookie à effacer, un client natif n'en a jamais eu. Les deux
 * routes cohabitent donc au lieu de s'écraser : même effet sur la validité du jeton, deux
 * intentions différentes sur ce qui reste écrit.
 *
 * ## Porteur obligatoire
 *
 * `Authorization: Bearer <jeton>`, jamais un cookie — c'est la seule façon dont un client natif
 * s'authentifie (voir `readBearerToken` dans `functions/api/_auth.ts`). Refuser le cookie ici n'est
 * pas une formalité : un navigateur l'envoie tout seul, donc une page tierce pourrait faire
 * effacer la session de son visiteur sans qu'il l'ait demandé. Un porteur, lui, n'est envoyé que
 * par un appelant qui le construit — c'est aussi ce qui dispense cette route du contrôle CSRF. Un
 * navigateur qui veut se déconnecter a `/logout` et `DELETE /sessions`, tous deux protégés par
 * `requireCsrf`.
 *
 * ## Ce que l'appel emporte d'autre
 *
 * Les appairages natifs **périmés** ([`AuthStore.purgeExpiredPairings`]) : `native_pairings` porte
 * le jeton de session en clair jusqu'au premier sondage qui le consomme (voir le schéma), et
 * personne ne repasse derrière une tentative d'appairage abandonnée. Cloudflare Pages n'offrant pas
 * de cron (voir `server/README.md`), ces lignes se purgent à l'occasion d'autres appels, comme les
 * autorisations OAuth au retour du fournisseur — l'effacement demandé par l'utilisateur est
 * exactement la bonne occasion. La purge n'est pas ciblée sur son compte : `native_pairings` n'a
 * pas de `user_id` (rien n'y relie une tentative à un compte avant qu'elle ne soit réclamée), donc
 * ce ménage vaut pour toutes les lignes expirées, ce qui ne divulgue rien.
 *
 * Réponse `{ deleted: true|false }` — `false` quand la ligne n'existait plus (appel rejoué, session
 * déjà effacée). Jamais une erreur : côté overlay, l'appel est best-effort, il précède un
 * effacement local qui a lieu de toute façon.
 *
 * Le ménage de conservation (sessions mortes depuis plus de 30 jours, comptes inactifs depuis
 * 12 mois — `runRetentionPurges`, flow.ts) est fait aux deux verbes, pour la même raison que les appairages : pas de cron, on profite des appels
 * qui touchent déjà à la table.
 */

/** Porteur obligatoire + authentification + limitation de débit, communs aux deux verbes. */
async function authenticateBearer(
  context: Parameters<PagesFunction<Env>>[0],
  now: Date,
): Promise<AuthenticatedContext | Response> {
  // Décidé sur la source EFFECTIVE (audit du 2026-09-23) : un en-tête `Authorization` présent mais
  // mal formé n'est plus un porteur, et `authenticate` ne retombe jamais sur le cookie dans ce cas.
  const credential = readRequestCredential(context.request);
  if (credential.kind !== 'token' || credential.via !== 'bearer') {
    return jsonError('porteur Authorization requis', 401);
  }

  const auth = await authenticate(context.request, context.env);
  if (!auth || auth.via !== 'bearer') return unauthenticated();

  const limit = await checkRateLimit(
    auth.store,
    `auth:session:ip:${await clientIpKey(context.request, context.env)}`,
    SESSION_RULE,
    now,
  );
  if (!limit.allowed) {
    return jsonError('trop de requêtes', 429, { 'retry-after': String(limit.retryAfterSeconds) });
  }
  return auth;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const now = new Date();
  const auth = await authenticateBearer(context, now);
  if (auth instanceof Response) return auth;

  // Seule une session émise par APPAIRAGE natif se renouvelle ici (audit du 2026-09-23, #8) : un
  // jeton de session de navigateur présenté en porteur (cookie `HttpOnly` exfiltré) ne doit pas
  // pouvoir s'échanger contre des jetons neufs, qui survivraient à la déconnexion du navigateur.
  if (!isNativeSession(auth.session)) {
    return jsonError('rotation réservée aux sessions de client natif', 403);
  }

  let rotated: Awaited<ReturnType<typeof rotateNativeSession>>;
  try {
    rotated = await rotateNativeSession(auth.store, { current: auth.session, now });
  } catch (error) {
    // Une autre rotation du même jeton a gagné la course (voir `NativeRotationConflictError`).
    if (error instanceof NativeRotationConflictError) {
      return jsonError('rotation concurrente, réessayer avec le jeton le plus récent', 409);
    }
    throw error;
  }
  // Seconde rotation de rattrapage depuis une session déjà remplacée : toute la chaîne vient d'être
  // révoquée (voir `rotateNativeSession`) — l'overlay doit se réappairer.
  if (!rotated) return unauthenticated();

  return json({
    token: rotated.token,
    issuedAt: rotated.issuedAt.toISOString(),
    expiresAt: rotated.expiresAt.toISOString(),
    previousTokenValidUntil: rotated.previousTokenValidUntil.toISOString(),
  });
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const now = new Date();
  const auth = await authenticateBearer(context, now);
  if (auth instanceof Response) return auth;

  // Les autres jetons de la chaîne (ancien jeton encore en grâce après une rotation) sont révoqués
  // avec elle (audit du 2026-09-23, S7) : une déconnexion ne laisse aucun jeton valable derrière.
  await auth.store.revokeSessionChain(sessionChainId(auth.session), now, auth.sessionIdHash);
  const deleted = await auth.store.deleteSession(auth.sessionIdHash);
  await auth.store.purgeExpiredPairings(now);
  await runRetentionPurges(auth.store, now);

  return json({ deleted });
};
