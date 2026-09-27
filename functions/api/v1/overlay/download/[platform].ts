import type { PagesFunction } from '@cloudflare/workers-types';
import {
  downloadHeaders,
  isOverlayPlatform,
  isTrustedGithubDownloadUrl,
  overlayAssetUrl,
} from '../../../../../server/overlay/release';
import { authenticate } from '../../../_auth';
import { loadOverlayRelease } from '../../../_overlay';
import type { Env } from '../../../_types';

/** Un binaire d'une version donnée ne change jamais : gardé un jour en cache périphérique, pour ne
 * pas le redemander à GitHub à chaque téléchargement. */
const ASSET_CACHE_SECONDS = 24 * 60 * 60;

// GET /api/v1/overlay/download/{windows|linux} — dernière version de l'overlay de bureau, prête à
// lancer : le binaire gzip de la Release GitHub est relayé tel quel avec `Content-Encoding: gzip`,
// le navigateur enregistre directement `wakfu-companion-overlay.exe` (Windows) ou
// `wakfu-companion-overlay` (Linux) — voir `server/overlay/release.ts`.
//
// Réservé aux comptes connectés (session du site ou jeton de l'overlay) : l'encart n'est proposé
// qu'aux utilisateurs connectés, et le relais ne doit pas servir de miroir public à des dizaines de
// Mo par requête. Appelé par une navigation (lien de téléchargement), pas un fetch : une session
// expirée renvoie donc vers l'onglet Connexion plutôt que vers un JSON d'erreur.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const platform = String(context.params['platform'] ?? '');
  if (!isOverlayPlatform(platform)) {
    return new Response(JSON.stringify({ error: 'plateforme inconnue' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!(await authenticate(context.request, context.env))) {
    return new Response(null, {
      status: 302,
      headers: { location: '/account', 'cache-control': 'no-store' },
    });
  }

  const release = await loadOverlayRelease(context.request.url, (promise) =>
    context.waitUntil(promise),
  );
  const assetUrl = release ? overlayAssetUrl(release, platform) : null;
  if (!release || !assetUrl) return unavailable();

  let upstream: Response;
  try {
    upstream = (await fetch(assetUrl, {
      cf: { cacheEverything: true, cacheTtl: ASSET_CACHE_SECONDS },
    })) as unknown as Response;
  } catch (error) {
    console.error('[overlay] binaire injoignable', error);
    return unavailable();
  }
  if (!upstream.ok || !upstream.body || !isTrustedGithubDownloadUrl(upstream.url || assetUrl)) {
    console.error('[overlay] binaire refusé', upstream.status, upstream.url);
    return unavailable();
  }

  // `encodeBody: 'manual'` : les octets sont DÉJÀ gzip ; sans cette option, le runtime les
  // recompresserait (ou refuserait l'en-tête) au lieu de les transmettre tels quels.
  return new Response(upstream.body, {
    status: 200,
    headers: downloadHeaders(platform, release.version),
    encodeBody: 'manual',
  } as ResponseInit);
};

function unavailable(): Response {
  return new Response(JSON.stringify({ error: 'overlay indisponible' }), {
    status: 502,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
