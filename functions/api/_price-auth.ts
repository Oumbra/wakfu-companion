// Fichier utilitaire (préfixe `_`) : Cloudflare Pages Functions route tout
// fichier de functions/ SAUF ceux préfixés par `_` — voir _types.ts.

import type { Env } from './_types';

/**
 * Vérifie le jeton de service statique (en-tête `Authorization: Bearer <jeton>`) protégeant les
 * endpoints d'écriture/export prix (lot 4, prompt 4.2) : POST /prices/ingest (skill vidéo, 4.1),
 * GET /prices/export et POST /prices/rollups (skill de calcul de trends). Volontairement PAS une
 * session utilisateur — ces endpoints ne sont jamais appelés depuis le navigateur d'un joueur,
 * seulement par des skills locaux, sans rapport avec l'authentification Discord/Google du lot 5
 * (pas encore implémentée) — voir docs/plan-migration-serveur.md §8.
 *
 * Retourne une `Response` 401 (ou 500 si le secret n'est pas configuré côté serveur) prête à
 * renvoyer telle quelle si l'appel n'est pas autorisé, `null` si l'appel peut continuer.
 */
export function checkPriceServiceToken(request: Request, env: Env): Response | null {
  const expected = env.PRICE_SERVICE_TOKEN;
  if (!expected) {
    return new Response(
      JSON.stringify({ error: 'PRICE_SERVICE_TOKEN non configuré côté serveur' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

  if (!provided || provided !== expected) {
    return new Response(JSON.stringify({ error: 'jeton de service invalide ou manquant' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  return null;
}
