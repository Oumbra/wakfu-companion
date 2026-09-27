import type { PagesFunction } from '@cloudflare/workers-types';
import { summarizeRelease } from '../../../../server/overlay/release';
import { loadOverlayRelease } from '../../_overlay';
import type { Env } from '../../_types';

// GET /api/v1/overlay/latest — version de l'overlay de bureau proposée au téléchargement (numéro,
// date, tailles par plateforme), pour l'encart « Overlay de bureau » de l'onglet Connexion du
// profil. Informations publiques (celles de la page Releases de GitHub) : ni authentification ni
// jeton d'application. Le manifeste est gardé 5 minutes en cache périphérique (`loadOverlayRelease`).
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const release = await loadOverlayRelease(context.request.url, (promise) =>
    context.waitUntil(promise),
  );
  if (!release) {
    return new Response(JSON.stringify({ error: 'overlay indisponible' }), {
      status: 502,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  return new Response(JSON.stringify(summarizeRelease(release)), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
  });
};
