import type { PagesFunction } from '@cloudflare/workers-types';
import { createDb } from '../../../server/db/client';
import { gameServers } from '../../../server/db/schema';
import type { Env } from '../_types';

// GET /api/v1/game-servers — liste servie par la base, jamais compilée en
// dur côté client (voir prompt 2.1). Table minuscule et quasi statique :
// pas de pagination, pas de cache serveur pour l'instant.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const db = createDb(context.env.DATABASE_URL);
  const servers = await db.select().from(gameServers);

  return new Response(JSON.stringify(servers), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
