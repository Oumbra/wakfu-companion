import type { PagesFunction } from '@cloudflare/workers-types';
import { sql } from 'drizzle-orm';
import { createDb } from '../../../server/db/client';
import type { Env } from '../_types';

// GET /api/v1/health — état du serveur + connectivité DB. Volontairement pas
// d'authentification : sert de sonde simple (monitoring, debug manuel).
//
// Correctif du 2026-09-23 (audit sécurité) : le message d'erreur de la base
// (`dbError`) n'est plus renvoyé — route publique, il pouvait exposer l'hôte
// Neon, le nom de la base ou d'un rôle. Il est journalisé côté serveur
// (`console.error`, journaux Cloudflare) ; la réponse ne dit plus que
// `db: 'error'`. `no-store` : un état de santé mis en cache ne dit rien.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const startedAt = Date.now();
  let dbOk = false;

  try {
    const db = createDb(context.env.DATABASE_URL);
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch (error) {
    console.error('[health] base injoignable', error);
  }

  const body = {
    status: dbOk ? 'ok' : 'degraded',
    version: '0.0.0', // aligné sur package.json — pas de schéma de version API distinct pour l'instant
    db: dbOk ? 'ok' : 'error',
    latencyMs: Date.now() - startedAt,
  };

  return new Response(JSON.stringify(body), {
    status: dbOk ? 200 : 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
