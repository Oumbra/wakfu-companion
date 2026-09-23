import type { PagesFunction } from '@cloudflare/workers-types';
import {
  decideHost,
  rejectedHostResponse,
  withSecurityHeaders,
  type HostGuardEnv,
} from '../../server/http/host-guard';
import type { Env } from './_types';

/**
 * Middleware de toutes les routes `/api/*` (Pages Functions, correctif du 2026-09-23 — audit
 * sécurité). Logique pure dans `server/http/host-guard.ts` (testée) :
 *
 * 1. contrôle d'hôte — refuse (404) l'API servie depuis une URL de déploiement immuable
 *    `<hash>.<projet>.pages.dev` ou un alias de branche non attendu (voir `decideHost`) ;
 * 2. en-têtes de sécurité posés sur toutes les réponses, sans écraser ceux d'une route
 *    (`withSecurityHeaders`) — `public/_headers` ne couvre pas les réponses des Functions ;
 * 3. filet de dernier recours : une exception non interceptée par une route devient un 500 JSON
 *    générique, journalisé côté serveur, jamais son message.
 *
 * Placé sous `functions/api/` et non à la racine `functions/` : un middleware racine ferait passer
 * CHAQUE requête du site (JS, CSS, images statiques) par une invocation de Function — le
 * `_routes.json` généré par Wrangler passerait de `/api/*` à `/*` —, soit un coût (quota
 * d'invocations du plan) et un risque (en-têtes de `public/_headers`, CSP du site comprise, sur
 * des réponses statiques relayées par `next()`) sans rien apporter : toutes les Functions du
 * projet vivent sous `/api/`.
 */
export const onRequest: PagesFunction<Env & HostGuardEnv> = async (context) => {
  const { hostname } = new URL(context.request.url);
  if (decideHost(hostname, context.env) === 'reject') return rejectedHostResponse();

  let response: Response;
  try {
    response = (await context.next()) as unknown as Response;
  } catch (error) {
    console.error('[api] exception non interceptée', error);
    response = new Response(JSON.stringify({ error: 'erreur interne' }), {
      status: 500,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  return withSecurityHeaders(response);
};
