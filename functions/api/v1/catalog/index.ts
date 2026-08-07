import type { PagesFunction } from '@cloudflare/workers-types';
import { createDb } from '../../../../server/db/client';
import { items, monsters } from '../../../../server/db/schema';
import { buildCompactIndex } from '../../../../server/catalog/compact-index';
import type { Env } from '../../_types';

// GET /api/v1/catalog/ — index compact objets+monstres pour
// core/api/catalog.service.ts (lot 3.1). Fichier nommé index.ts à dessein :
// convention Cloudflare Pages Functions, où index.ts sert la racine de son
// dossier (`/api/v1/catalog/`) — NE PAS appeler ce endpoint `/catalog/index`
// côté client, ce segment littéral se prend une redirection 308 vers
// `/catalog/` (bug réel constaté en prod, cassait silencieusement le
// chargement du catalogue — voir CatalogService.refreshIfNeeded).
// ~1,14 Mo bruts / ~348 Ko gzip mesurés sur le référentiel actuel (11 032
// objets + 851 monstres, 4 langues) — voir server/catalog/compact-index.ts
// pour le format exact (tuples, PAS d'objets à clés répétées) et
// server/README.md pour le détail des mesures.
//
// PAS de compression manuelle (CompressionStream + content-encoding: gzip
// posé à la main) : bug réel constaté en prod — un Content-Encoding défini
// par le script du Worker lui-même n'est PAS décompressé de façon fiable
// par fetch() côté navigateur (contrairement à une compression négociée
// "normalement" par un vrai proxy/CDN), le client recevait les octets gzip
// bruts et `response.json()` échouait avec une SyntaxError. Corrigé en
// renvoyant le JSON brut et en laissant Cloudflare appliquer sa compression
// automatique d'edge (gzip/brotli selon l'Accept-Encoding du client) — même
// mécanisme que pour n'importe quelle réponse JSON servie par ce dépôt,
// correctement décompressé par le navigateur. Le budget "< 400 Ko" du
// prompt 2.2 s'entend sur ce qui est réellement transféré une fois cette
// compression automatique appliquée (voir server/README.md).
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const db = createDb(context.env.DATABASE_URL);

  const [itemRows, monsterRows] = await Promise.all([
    db
      .select({
        ankamaId: items.ankamaId,
        fr: items.fr,
        en: items.en,
        es: items.es,
        pt: items.pt,
        gfxId: items.gfxId,
        rarity: items.rarity,
        hasRecipe: items.hasRecipe,
      })
      .from(items),
    db
      .select({
        id: monsters.id,
        fr: monsters.fr,
        en: monsters.en,
        es: monsters.es,
        pt: monsters.pt,
        gfxId: monsters.gfxId,
        family: monsters.family,
        isBoss: monsters.isBoss,
        isArchi: monsters.isArchi,
        isDominant: monsters.isDominant,
      })
      .from(monsters),
  ]);

  const compactIndex = buildCompactIndex(itemRows, monsterRows);
  const jsonText = JSON.stringify(compactIndex);

  return new Response(jsonText, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      // Contenu figé pour une version donnée du référentiel (voir
      // GET /api/v1/catalog/version pour détecter un changement) : mise en
      // cache CDN raisonnable, revalidée par le navigateur au besoin.
      'cache-control': 'public, max-age=300',
    },
  });
};
