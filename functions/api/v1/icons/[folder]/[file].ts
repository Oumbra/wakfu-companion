import type { PagesFunction } from '@cloudflare/workers-types';
import { identifyCaller, relayHeaders, upstreamUrl } from '../../../../../server/icons/proxy';
import type { Env } from '../../../_types';

// GET /api/v1/icons/{folder}/{gfxId}.png — relais d'icônes `wakassets` pour l'overlay de bureau
// (2026-09-19, constat C10 RGPD : l'adresse IP de l'utilisateur ne sort plus vers GitHub Pages
// pour une icône) et pour le site. Sans authentification (une icône n'a rien de personnel, et
// l'overlay en charge avant même d'être appairé), mais réservé à ces deux appelants — reconnus par
// la signature de la requête, voir `identifyCaller` : le relais redistribue des images du jeu, il
// ne doit pas servir de CDN à des pages tierces (2026-09-20, docs/analyse-cgu.md, reco 8). Voir
// server/icons/proxy.ts pour ce qui est accepté.
//
// Deux caches : `caches.default` (périphérie Cloudflare, indexé par l'URL de CETTE requête) pour
// ne pas remonter à l'amont à chaque utilisateur, et `cf.cacheTtl` sur le fetch amont par sécurité.
// L'overlay a de son côté son propre cache disque (`overlay_sync::icon_cache`) : une icône donnée
// n'arrive ici qu'une fois par installation.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  if (identifyCaller(context.request.headers, context.request.url) === null) {
    return new Response(JSON.stringify({ error: 'appelant non autorisé' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const folder = String(context.params['folder'] ?? '');
  const file = String(context.params['file'] ?? '');
  const upstream = upstreamUrl({ folder, file });
  if (!upstream) {
    return new Response(JSON.stringify({ error: 'icône invalide' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const cache = caches.default;
  const cacheKey = new Request(context.request.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = await fetch(upstream, {
    cf: { cacheEverything: true, cacheTtl: 24 * 60 * 60 },
  });

  let relayed: Response;
  if (response.ok) {
    relayed = new Response(response.body, { status: 200, headers: relayHeaders(200) });
  } else if (response.status === 404) {
    relayed = new Response(JSON.stringify({ error: 'icône introuvable' }), {
      status: 404,
      headers: relayHeaders(404),
    });
  } else {
    // Amont en panne : rien à mettre en cache, l'overlay retombe sur son icône générique.
    return new Response(JSON.stringify({ error: 'source d’icônes indisponible' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  context.waitUntil(cache.put(cacheKey, relayed.clone()));
  return relayed;
};
