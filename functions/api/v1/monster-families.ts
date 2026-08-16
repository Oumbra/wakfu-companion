import type { PagesFunction } from '@cloudflare/workers-types';
import { createDb } from '../../../server/db/client';
import { monsterFamilies } from '../../../server/db/schema';
import type { Env } from '../_types';

// GET /api/v1/monster-families — liste complète (~150 lignes, toutes colonnes) pour
// core/api/catalog.service.ts, même principe que /dungeons (volume négligeable, chargé une fois
// au démarrage et mis en cache IndexedDB) — sert à afficher le vrai libellé localisé du palier
// "famille de monstre" du regroupement "Type" de l'historique des combats
// (resolveFightTypeClassification, core/utils/fight-image.util.ts), à la place du nom d'un
// monstre membre du groupe utilisé jusqu'ici faute de cette table (voir server/db/schema.ts).
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const db = createDb(context.env.DATABASE_URL);
  const rows = await db.select().from(monsterFamilies);

  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300',
    },
  });
};
