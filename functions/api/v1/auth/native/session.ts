import type { PagesFunction } from '@cloudflare/workers-types';
import { SESSION_RULE, checkRateLimit, clientIp } from '../../../../../server/auth/rate-limit';
import { authenticate, json, jsonError, unauthenticated } from '../../../_auth';
import type { Env } from '../../../_types';

/**
 * DELETE /api/v1/auth/native/session — **le client natif efface sa session côté serveur**
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
 */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  if (!context.request.headers.get('authorization')?.startsWith('Bearer ')) {
    return jsonError('porteur Authorization requis', 401);
  }

  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();

  const now = new Date();
  const limit = await checkRateLimit(
    auth.store,
    `auth:session:ip:${clientIp(context.request)}`,
    SESSION_RULE,
    now,
  );
  if (!limit.allowed) {
    return jsonError('trop de requêtes', 429, { 'retry-after': String(limit.retryAfterSeconds) });
  }

  const deleted = await auth.store.deleteSession(auth.sessionIdHash);
  await auth.store.purgeExpiredPairings(now);

  return json({ deleted });
};
