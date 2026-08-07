import type { PagesFunction } from '@cloudflare/workers-types';
import { createDb } from '../../../../server/db/client';
import { items, monsters } from '../../../../server/db/schema';
import { buildCompactIndex } from '../../../../server/catalog/compact-index';
import type { Env } from '../../_types';

// GET /api/v1/catalog/index — index compact objets+monstres pour
// core/api/catalog.service.ts (lot 3.1). ~1,14 Mo bruts / ~348 Ko gzip
// mesurés sur le référentiel actuel (11 032 objets + 851 monstres, 4
// langues) — voir server/catalog/compact-index.ts pour le format exact
// (tuples, PAS d'objets à clés répétées) et server/README.md pour le détail
// des mesures. Compressé en gzip via CompressionStream (Web Streams,
// disponible nativement dans le runtime Workers) : le budget "< 400 Ko"
// du prompt 2.2 s'entend sur ce qui est réellement transféré (Content-Encoding
// gzip), pas sur le JSON brut — voir server/README.md pour la justification.
// Chargé UNE FOIS au démarrage puis mis en cache IndexedDB côté client (pas
// à chaque frappe/chargement) : le poids réel supporté par l'utilisateur
// est donc bien inférieur à ce que suggère la taille brute de la réponse.
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
  const compressedStream = new Blob([jsonText]).stream().pipeThrough(new CompressionStream('gzip'));

  return new Response(compressedStream, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      // Contenu figé pour une version donnée du référentiel (voir
      // GET /api/v1/catalog/version pour détecter un changement) : mise en
      // cache CDN raisonnable, revalidée par le navigateur au besoin.
      'cache-control': 'public, max-age=300',
    },
  });
};
