import type { PagesFunction } from '@cloudflare/workers-types';
import { and, desc, eq, lt } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { purchases } from '../../../../server/db/schema';
import {
  MAX_HISTORY_BATCH,
  parsePageQuery,
  parsePurchasesBody,
} from '../../../../server/history/parse';
import { authenticate, json, jsonError, requireCsrf, unauthenticated } from '../../_auth';
import type { Env } from '../../_types';

/**
 * Historique d'achats du compte (lot 8, prompt 8.1). Une seule table, donc pas
 * de séquence en trois temps comme pour les combats : un `INSERT ... ON
 * CONFLICT DO NOTHING` suffit à rendre l'ingestion idempotente.
 *
 * `gameServer` vient de `GameServerService` côté client (lot 7) — et reste
 * vide quand aucun serveur n'a pu être déduit : l'achat part quand même
 * (prompt 8.1 point 4). Aucun rapport avec le monitoring de prix (lot 4), dont
 * la source est un scan de l'hôtel des ventes, jamais les achats des joueurs.
 */

const MAX_PAYLOAD_BYTES = 512 * 1024;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();
  if (!(await requireCsrf(context.request, auth))) return jsonError('jeton CSRF invalide', 403);

  const raw = await context.request.text();
  if (raw.length > MAX_PAYLOAD_BYTES) return jsonError('lot trop volumineux', 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError('corps JSON invalide', 400);
  }

  const parsed = parsePurchasesBody(body);
  if (!parsed.ok) return jsonError(parsed.error, 400);
  if (parsed.value.length === 0) return json({ accepted: [], inserted: 0 });

  const db = createDb(context.env.DATABASE_URL);
  const inserted = await db
    .insert(purchases)
    .values(
      parsed.value.map((purchase) => ({
        userId: auth.user.id,
        clientKey: purchase.clientKey,
        itemId: purchase.itemId,
        itemName: purchase.itemName,
        quantity: purchase.quantity,
        totalCost: purchase.totalCost,
        occurredAt: purchase.occurredAt,
        gameServer: purchase.gameServer,
      })),
    )
    .onConflictDoNothing({ target: [purchases.userId, purchases.clientKey] })
    .returning({ clientKey: purchases.clientKey });

  return json({
    accepted: parsed.value.map((purchase) => purchase.clientKey),
    inserted: inserted.length,
  });
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();

  const query = parsePageQuery(new URL(context.request.url).searchParams);
  if (!query.ok) return jsonError(query.error, 400);

  const db = createDb(context.env.DATABASE_URL);
  const where = query.value.before
    ? and(eq(purchases.userId, auth.user.id), lt(purchases.occurredAt, query.value.before))
    : eq(purchases.userId, auth.user.id);

  const rows = await db
    .select()
    .from(purchases)
    .where(where)
    .orderBy(desc(purchases.occurredAt), desc(purchases.id))
    .limit(query.value.limit);

  return json({
    entries: rows.map((row) => ({
      clientKey: row.clientKey,
      itemId: row.itemId,
      itemName: row.itemName,
      quantity: row.quantity,
      totalCost: row.totalCost,
      occurredAt: row.occurredAt.toISOString(),
      gameServer: row.gameServer,
    })),
    nextBefore:
      rows.length === query.value.limit ? rows[rows.length - 1].occurredAt.toISOString() : null,
    maxBatch: MAX_HISTORY_BATCH,
  });
};
