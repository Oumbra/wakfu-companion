import type { PagesFunction } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { monsters } from '../../../../server/db/schema';
import { parseAnkamaId } from '../../../../server/catalog/params';
import { rejectUnknownCaller } from '../../_caller';
import type { Env } from '../../_types';

// GET /api/v1/monsters/{id} — détail complet d'un monstre (id Ankama,
// unique — voir schema.ts, contrairement aux objets).
export const onRequestGet: PagesFunction<Env> = async (context) => {
  // Réservé au site et à l'overlay (docs/analyse-cgu-2026-09-21.md, reco 4) — voir functions/api/_caller.ts.
  const rejected = await rejectUnknownCaller(context.request, context.env);
  if (rejected) return rejected;
  // Entier positif ≤ PG_INT32_MAX (server/catalog/params.ts) : au-delà, la requête SQL échouait en 500.
  const id = parseAnkamaId(context.params['id']);
  if (id === null) {
    return new Response(JSON.stringify({ error: 'id invalide' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const db = createDb(context.env.DATABASE_URL);
  const [monster] = await db.select().from(monsters).where(eq(monsters.id, id)).limit(1);

  if (!monster) {
    return new Response(JSON.stringify({ error: 'monstre introuvable' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(monster), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
