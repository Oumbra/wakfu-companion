import type { PagesFunction } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { catalogMeta } from '../../../../server/db/schema';
import type { Env } from '../../_types';

// GET /api/v1/catalog/version — métadonnées du dernier import réussi (voir
// server/import/import-catalog.ts). Pas de "version gamedata" au sens
// Ankama (ce dépôt n'interroge plus l'API Ankama en direct, voir
// server/README.md) : sourceCommit + indexHash servent d'équivalent pour
// détecter côté client si le catalogue local (lot 3) est à jour.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const db = createDb(context.env.DATABASE_URL);
  const [row] = await db.select().from(catalogMeta).where(eq(catalogMeta.id, 'catalog')).limit(1);

  if (!row) {
    return new Response(JSON.stringify({ error: 'catalogue non encore importé' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      sourceCommit: row.sourceCommit,
      importedAt: row.importedAt,
      indexHash: row.indexHash,
      itemsCount: row.itemsCount,
      monstersCount: row.monstersCount,
      dungeonsCount: row.dungeonsCount,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};
