import type { PagesFunction } from '@cloudflare/workers-types';
import { sql } from 'drizzle-orm';
import { createDb } from '../../../server/db/client';
import type { Env } from '../_types';

// GET /api/v1/health — état du serveur + connectivité DB. Volontairement pas
// de authentification/cache : sert de sonde simple (monitoring, debug manuel).
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const startedAt = Date.now();
  let dbOk = false;
  let dbError: string | undefined;

  try {
    const db = createDb(context.env.DATABASE_URL);
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch (error) {
    dbError = error instanceof Error ? error.message : String(error);
  }

  const body = {
    status: dbOk ? 'ok' : 'degraded',
    version: '0.0.0', // aligné sur package.json — pas de schéma de version API distinct pour l'instant
    db: dbOk ? 'ok' : 'error',
    dbError,
    latencyMs: Date.now() - startedAt,
  };

  return new Response(JSON.stringify(body), {
    status: dbOk ? 200 : 503,
    headers: { 'content-type': 'application/json' },
  });
};
