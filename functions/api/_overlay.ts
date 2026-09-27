// Fichier utilitaire (préfixe `_`) : non routé par Pages Functions — voir _types.ts.

import {
  OVERLAY_MANIFEST_URL,
  isTrustedGithubDownloadUrl,
  parseOverlayManifest,
  type OverlayRelease,
} from '../../server/overlay/release';

/** Durée de vie du manifeste en cache périphérique : une Release récente est proposée au plus
 * 5 minutes après sa publication, sans aller chez GitHub à chaque visite de la page. */
const MANIFEST_CACHE_SECONDS = 300;

/**
 * Dernière Release de l'overlay, lue dans le manifeste `latest.json` (voir
 * `server/overlay/release.ts`) et gardée en cache périphérique (`caches.default`) sous une clé
 * interne propre à l'origine — la preview et la production ne partagent pas leurs entrées.
 * `null` si GitHub est injoignable ou si le manifeste est inexploitable.
 */
export async function loadOverlayRelease(
  requestUrl: string,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<OverlayRelease | null> {
  const cache = caches.default;
  const cacheKey = new Request(`${new URL(requestUrl).origin}/api/v1/overlay/__manifest`);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const release = parseCachedRelease(await cached.text());
    if (release) return release;
  }

  let response: Response;
  try {
    response = (await fetch(OVERLAY_MANIFEST_URL, {
      headers: { accept: 'application/json' },
    })) as unknown as Response;
  } catch (error) {
    console.error('[overlay] manifeste injoignable', error);
    return null;
  }
  if (!response.ok || !isTrustedGithubDownloadUrl(response.url || OVERLAY_MANIFEST_URL)) {
    console.error('[overlay] manifeste refusé', response.status, response.url);
    return null;
  }

  let release: OverlayRelease | null;
  try {
    release = parseOverlayManifest(await response.json());
  } catch {
    release = null;
  }
  if (!release) {
    console.error('[overlay] manifeste inexploitable');
    return null;
  }

  waitUntil(
    cache.put(
      cacheKey,
      new Response(JSON.stringify(release), {
        headers: {
          'content-type': 'application/json',
          'cache-control': `public, max-age=${MANIFEST_CACHE_SECONDS}`,
        },
      }),
    ),
  );
  return release;
}

/** Relit une entrée de cache écrite par `loadOverlayRelease` (déjà au format `OverlayRelease`). */
function parseCachedRelease(text: string): OverlayRelease | null {
  try {
    const value = JSON.parse(text) as OverlayRelease;
    return typeof value?.version === 'string' && typeof value.assets === 'object' ? value : null;
  } catch {
    return null;
  }
}
