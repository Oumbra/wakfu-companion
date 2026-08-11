import type { PagesFunction } from '@cloudflare/workers-types';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { tradeItems, trades } from '../../../../server/db/schema';
import {
  MAX_HISTORY_BATCH,
  parsePageQuery,
  parseTradesBody,
} from '../../../../server/history/parse';
import { authenticate, json, jsonError, requireCsrf, unauthenticated } from '../../_auth';
import type { Env } from '../../_types';

/**
 * Historique d'échanges du compte (lot 8, prompt 8.1).
 *
 * Même séquence en trois temps que les combats (`insert` → `select` →
 * `insert` des lignes filles) et pour la même raison : faute de transaction
 * avec le driver `neon-http`, seule une écriture des filles indépendante de la
 * question « le parent vient-il d'être créé ? » se répare toute seule au rejeu.
 * Voir functions/api/v1/history/fights.ts pour le détail.
 *
 * Le nom du partenaire d'échange est une donnée de tiers ; il est conservé
 * parce qu'il est indissociable de l'événement lui-même (un échange sans
 * partenaire n'a pas de sens), contrairement au contenu du chat, qui, lui,
 * n'est jamais transmis (prompt 8.1 point 5).
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

  const parsed = parseTradesBody(body);
  if (!parsed.ok) return jsonError(parsed.error, 400);
  if (parsed.value.length === 0) return json({ accepted: [], inserted: 0 });

  const db = createDb(context.env.DATABASE_URL);
  const userId = auth.user.id;

  const inserted = await db
    .insert(trades)
    .values(
      parsed.value.map((trade) => ({
        userId,
        clientKey: trade.clientKey,
        peerName: trade.peerName,
        selfName: trade.selfName,
        occurredAt: trade.occurredAt,
        kamasAcquired: trade.kamasAcquired,
        kamasGiven: trade.kamasGiven,
        gameServer: trade.gameServer,
      })),
    )
    .onConflictDoNothing({ target: [trades.userId, trades.clientKey] })
    .returning({ clientKey: trades.clientKey });

  const keys = parsed.value.map((trade) => trade.clientKey);
  const stored = await db
    .select({ id: trades.id, clientKey: trades.clientKey })
    .from(trades)
    .where(and(eq(trades.userId, userId), inArray(trades.clientKey, keys)));
  const idByKey = new Map(stored.map((row) => [row.clientKey, row.id]));

  const itemRows = parsed.value.flatMap((trade) => {
    const tradeId = idByKey.get(trade.clientKey);
    if (tradeId === undefined) return [];
    return trade.items.map((item) => ({
      tradeId,
      direction: item.direction,
      lineIndex: item.lineIndex,
      itemId: item.itemId,
      itemName: item.itemName,
      quantity: item.quantity,
    }));
  });

  if (itemRows.length > 0) {
    await db.insert(tradeItems).values(itemRows).onConflictDoNothing();
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
    ? and(eq(trades.userId, auth.user.id), lt(trades.occurredAt, query.value.before))
    : eq(trades.userId, auth.user.id);

  const rows = await db
    .select()
    .from(trades)
    .where(where)
    .orderBy(desc(trades.occurredAt), desc(trades.id))
    .limit(query.value.limit);

  const items =
    rows.length > 0
      ? await db
          .select()
          .from(tradeItems)
          .where(
            inArray(
              tradeItems.tradeId,
              rows.map((row) => row.id),
            ),
          )
      : [];

  const itemsByTrade = new Map<number, typeof items>();
  for (const item of items) {
    const list = itemsByTrade.get(item.tradeId) ?? [];
    list.push(item);
    itemsByTrade.set(item.tradeId, list);
  }

  return json({
    entries: rows.map((row) => {
      const lines = (itemsByTrade.get(row.id) ?? []).sort((a, b) => a.lineIndex - b.lineIndex);
      return {
        clientKey: row.clientKey,
        peerName: row.peerName,
        selfName: row.selfName,
        occurredAt: row.occurredAt.toISOString(),
        kamasAcquired: row.kamasAcquired,
        kamasGiven: row.kamasGiven,
        gameServer: row.gameServer,
        acquired: lines
          .filter((line) => line.direction === 'acquired')
          .map((line) => ({
            itemId: line.itemId,
            itemName: line.itemName,
            quantity: line.quantity,
          })),
        given: lines
          .filter((line) => line.direction === 'given')
          .map((line) => ({
            itemId: line.itemId,
            itemName: line.itemName,
            quantity: line.quantity,
          })),
      };
    }),
    nextBefore:
      rows.length === query.value.limit ? rows[rows.length - 1].occurredAt.toISOString() : null,
    maxBatch: MAX_HISTORY_BATCH,
  });
};
