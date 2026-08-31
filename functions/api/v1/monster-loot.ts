import type { PagesFunction } from '@cloudflare/workers-types';
import { gt, sql } from 'drizzle-orm';
import { createDb } from '../../../server/db/client';
import { monsters } from '../../../server/db/schema';
import type { Env } from '../_types';

// GET /api/v1/monster-loot — table de loot par monstre (`monsters.loot`), pour
// core/api/catalog.service.ts (CatalogService.findMonsterLootItemIds — voir demande utilisateur sur
// la fiabilité de la détection de butin). Fichier PLAT sous v1/ (comme monster-families.ts),
// délibérément PAS sous monsters/ : éviterait de cohabiter avec la route dynamique
// monsters/[id].ts pour un segment littéral.
//
// Payload SÉPARÉ de /api/v1/catalog/ (jamais fusionné dans buildCompactIndex) : mesuré sur le
// référentiel réel, ~728 monstres avec du loot connu, ~17,6 objets en moyenne (jusqu'à 99) — feraient
// peser un volume non négligeable sur l'index compact chaud, chargé par toute l'app (recherche/
// autocomplétion comprises) pour une fonctionnalité de niche. Rafraîchi indépendamment de
// `indexHash` côté client, même principe que /dungeons et /monster-families.
//
// Tuples [monsterId, itemId[]] (pas d'objets à clés répétées), triés par id, UNIQUEMENT les
// monstres avec au moins un objet connu (`loot.length > 0` filtré en SQL via gt(length, 0)) — pas
// la peine d'envoyer un tableau vide pour les ~127 monstres sans loot connu.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const db = createDb(context.env.DATABASE_URL);
  const rows = await db
    .select({ id: monsters.id, loot: monsters.loot })
    .from(monsters)
    .where(gt(sql<number>`array_length(${monsters.loot}, 1)`, 0))
    .orderBy(monsters.id);

  const tuples = rows.map((row) => [row.id, row.loot]);

  return new Response(JSON.stringify(tuples), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300',
    },
  });
};
