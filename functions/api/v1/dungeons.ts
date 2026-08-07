import type { PagesFunction } from '@cloudflare/workers-types';
import { createDb } from '../../../server/db/client';
import { dungeons } from '../../../server/db/schema';
import type { Env } from '../_types';

// GET /api/v1/dungeons — liste complète (151 lignes, toutes colonnes) pour
// core/api/catalog.service.ts (lot 3.1). Contrairement à /catalog/index,
// pas besoin de format compact ni de tuples : le volume est négligeable
// (quelques dizaines de Ko), chargé une fois au démarrage et mis en cache
// IndexedDB comme le reste — sert à résoudre l'illustration de donjon d'un
// combat de boss (findWakfuDungeonByBossMonsterId côté client, voir
// core/utils/fight-image.util.ts).
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const db = createDb(context.env.DATABASE_URL);
  const rows = await db.select().from(dungeons);

  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300',
    },
  });
};
