// Service worker enregistré par l'application (src/app/app.config.ts) : enveloppe le worker
// Angular (`ngsw-worker.js`, généré au build) pour lui retirer TOUTES les requêtes cross-origin.
//
// Sans cette enveloppe, `ngsw-worker.js` intercepte aussi les images externes
// (`static.ankama.com` : avatars fan-art, monstres, objets) et les refait lui-même avec `fetch()`
// depuis le contexte du worker. Ce refetch est soumis à la CSP du script du worker figée à son
// installation (`connect-src`, pas `img-src`) : un worker installé quand `connect-src` ne listait
// pas `static.ankama.com` répond 504 à chaque image, et reste en place tant que le script ne
// change pas d'un octet. Symptôme vécu (2026-09-23) : portraits d'avatar invisibles, visibles
// seulement après un rechargement forcé (qui contourne le service worker), puis de nouveau cassés.
//
// Ce listener est enregistré AVANT celui d'Angular : pour une requête d'une autre origine,
// `stopImmediatePropagation()` empêche Angular de la voir, et l'absence de `respondWith()` rend la
// main au navigateur, qui la charge normalement (CSP et referrer-policy de la page).
//
// Même traitement pour le téléchargement de l'overlay de bureau (`/api/v1/overlay/download/*`,
// plusieurs dizaines de Mo relayés en `Content-Encoding: gzip`) : le navigateur le télécharge
// lui-même, sans que le worker Angular le rejoue et le fasse transiter par son propre `fetch()`.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/v1/overlay/download/')) {
    event.stopImmediatePropagation();
  }
});

importScripts('./ngsw-worker.js');
