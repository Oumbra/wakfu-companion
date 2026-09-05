import type { PagesFunction } from '@cloudflare/workers-types';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { pactExtractionItems, pactExtractions } from '../../../../server/db/schema';
import {
  MAX_HISTORY_BATCH,
  parsePactExtractionsBody,
  parsePageQuery,
} from '../../../../server/history/parse';
import { authenticate, json, jsonError, requireCsrf, unauthenticated } from '../../_auth';
import type { Env } from '../../_types';

/**
 * Historique d'extractions de pacte du compte — même séquence en trois temps que les combats/
 * échanges (`insert` → `select` → `insert` des lignes filles) et pour la même raison : faute de
 * transaction avec le driver `neon-http`, seule une écriture des filles indépendante de la question
 * « le parent vient-il d'être créé ? » se répare toute seule au rejeu. Voir
 * functions/api/v1/history/fights.ts pour le détail, functions/api/v1/history/trades.ts pour le
 * gabarit le plus proche (une extraction de pacte n'a qu'un seul "côté", contrairement à un échange).
 */

const MAX_PAYLOAD_BYTES = 1024 * 1024;

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

  const parsed = parsePactExtractionsBody(body);
  if (!parsed.ok) return jsonError(parsed.error, 400);
  if (parsed.value.length === 0) return json({ accepted: [], inserted: 0 });

  const db = createDb(context.env.DATABASE_URL);
  const userId = auth.user.id;

  const inserted = await db
    .insert(pactExtractions)
    .values(
      parsed.value.map((pact) => ({
        userId,
        clientKey: pact.clientKey,
        occurredAt: pact.occurredAt,
        gameServer: pact.gameServer,
      })),
    )
    .onConflictDoNothing({ target: [pactExtractions.userId, pactExtractions.clientKey] })
    .returning({ clientKey: pactExtractions.clientKey });

  const keys = parsed.value.map((pact) => pact.clientKey);
  const stored = await db
    .select({ id: pactExtractions.id, clientKey: pactExtractions.clientKey })
    .from(pactExtractions)
    .where(and(eq(pactExtractions.userId, userId), inArray(pactExtractions.clientKey, keys)));
  const idByKey = new Map(stored.map((row) => [row.clientKey, row.id]));

  const itemRows = parsed.value.flatMap((pact) => {
    const extractionId = idByKey.get(pact.clientKey);
    if (extractionId === undefined) return [];
    return pact.items.map((item) => ({
      extractionId,
      lineIndex: item.lineIndex,
      itemId: item.itemId,
      itemName: item.itemName,
      quantity: item.quantity,
    }));
  });

  if (itemRows.length > 0) {
    // `DO UPDATE` plutôt que `DO NOTHING` — voir functions/api/v1/history/purchases.ts (même
    // raison : correction manuelle d'objet homonyme, voir PactReassignService côté client).
    await db
      .insert(pactExtractionItems)
      .values(itemRows)
      .onConflictDoUpdate({
        target: [pactExtractionItems.extractionId, pactExtractionItems.lineIndex],
        set: { itemId: sql`excluded.item_id`, itemName: sql`excluded.item_name` },
      });
  }

  return json({ accepted: keys, inserted: inserted.length });
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();

  const query = parsePageQuery(new URL(context.request.url).searchParams);
  if (!query.ok) return jsonError(query.error, 400);

  const db = createDb(context.env.DATABASE_URL);
  const where = query.value.before
    ? and(
        eq(pactExtractions.userId, auth.user.id),
        lt(pactExtractions.occurredAt, query.value.before),
      )
    : eq(pactExtractions.userId, auth.user.id);

  const rows = await db
    .select()
    .from(pactExtractions)
    .where(where)
    .orderBy(desc(pactExtractions.occurredAt), desc(pactExtractions.id))
    .limit(query.value.limit);

  const items =
    rows.length > 0
      ? await db
          .select()
          .from(pactExtractionItems)
          .where(
            inArray(
              pactExtractionItems.extractionId,
              rows.map((row) => row.id),
            ),
          )
      : [];

  const itemsByExtraction = new Map<number, typeof items>();
  for (const item of items) {
    const list = itemsByExtraction.get(item.extractionId) ?? [];
    list.push(item);
    itemsByExtraction.set(item.extractionId, list);
  }

  return json({
    entries: rows.map((row) => ({
      clientKey: row.clientKey,
      occurredAt: row.occurredAt.toISOString(),
      gameServer: row.gameServer,
      items: (itemsByExtraction.get(row.id) ?? [])
        .sort((a, b) => a.lineIndex - b.lineIndex)
        .map((line) => ({ itemId: line.itemId, itemName: line.itemName, quantity: line.quantity })),
    })),
    nextBefore:
      rows.length === query.value.limit ? rows[rows.length - 1].occurredAt.toISOString() : null,
    maxBatch: MAX_HISTORY_BATCH,
  });
};
