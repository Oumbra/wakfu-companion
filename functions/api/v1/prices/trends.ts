import type { PagesFunction } from '@cloudflare/workers-types';
import { asc, desc, eq } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { priceTrends } from '../../../../server/db/schema';
import type { Env } from '../../_types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// GET /api/v1/prices/trends?server=&dir=up|down&limit= — classement « plus fortes hausses/baisses »
// (prompt 4.3), endpoint PUBLIC, lu directement dans price_trends (pré-calculée par le skill de
// trends, voir server/db/schema.ts) — JAMAIS recalculée à la volée, exactement l'exigence du
// prompt 4.2. `dir=up` trie par changePct décroissant (plus fortes hausses en premier), `dir=down`
// par changePct croissant (plus fortes baisses, valeurs les plus négatives en premier).
// Volontairement lean (itemId + valeurs numériques seulement, pas de nom/icône) : le client
// résout déjà itemId -> nom/icône en local via CatalogService, pas besoin de dupliquer ça ici.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const server = url.searchParams.get('server');
  if (!server) return jsonError('paramètre "server" requis', 400);

  const dir = url.searchParams.get('dir') ?? 'up';
  if (dir !== 'up' && dir !== 'down')
    return jsonError('paramètre "dir" invalide (attendu up|down)', 400);

  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return jsonError(`paramètre "limit" invalide (attendu un entier entre 1 et ${MAX_LIMIT})`, 400);
  }

  const db = createDb(context.env.DATABASE_URL);
  const rows = await db
    .select({
      itemId: priceTrends.itemId,
      avgLast30d: priceTrends.avgLast30d,
      avgPrev30d: priceTrends.avgPrev30d,
      changePct: priceTrends.changePct,
    })
    .from(priceTrends)
    .where(eq(priceTrends.gameServer, server))
    .orderBy(dir === 'up' ? desc(priceTrends.changePct) : asc(priceTrends.changePct))
    .limit(limit);

  return new Response(JSON.stringify({ gameServer: server, dir, items: rows }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
