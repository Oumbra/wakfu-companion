import type { PagesFunction } from '@cloudflare/workers-types';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { tradeItems, trades } from '../../../../server/db/schema';
import {
  MAX_HISTORY_BATCH,
  parsePageQuery,
  parseTradesBatch,
} from '../../../../server/history/parse';
import { ingestTrades } from '../../../../server/history/ingest';
import {
  MAX_TRADES_PER_ACCOUNT,
  checkHistoryQuota,
  loadKnownReferences,
} from '../../../../server/history/guards';
import { processHistoryBatch } from '../../../../server/history/batch';
import { historyStorageDeps } from '../../../../server/history/storage';
import { readJsonBodyLimited } from '../../../../server/http/body';
import { enforceUserRateLimit, internalErrorResponse } from '../../../../server/http/api-guards';
import { authenticate, json, jsonError, requireCsrf, unauthenticated } from '../../_auth';
import type { Env } from '../../_types';

/**
 * Historique d'échanges du compte (lot 8, prompt 8.1).
 *
 * Même séquence en trois temps que les combats (`insert` → `select` →
 * `insert` des lignes filles) et pour la même raison : faute de transaction
 * avec le driver `neon-http`, seule une écriture des filles indépendante de la
 * question « le parent vient-il d'être créé ? » se répare toute seule au rejeu.
 * Voir `server/history/ingest.ts` (`ingestFights`/`ingestTrades`) pour le détail.
 *
 * Le nom du partenaire d'échange est une donnée de tiers ; il est conservé
 * parce qu'il est indissociable de l'événement lui-même (un échange sans
 * partenaire n'a pas de sens), contrairement au contenu du chat, qui, lui,
 * n'est jamais transmis (prompt 8.1 point 5).
 */

const MAX_PAYLOAD_BYTES = 1024 * 1024;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const auth = await authenticate(context.request, context.env);
    if (!auth) return unauthenticated();
    if (!(await requireCsrf(context.request, auth))) return jsonError('jeton CSRF invalide', 403);
    // Limite de débit par compte (server/http/api-guards.ts) — avant toute lecture du corps.
    const limited = await enforceUserRateLimit(auth.store, 'history:write', auth.user.id);
    if (limited) return limited;

    const body = await readJsonBodyLimited(context.request, MAX_PAYLOAD_BYTES);
    if (!body.ok) return jsonError(body.error, body.status);
    // Volume écrit par compte, en octets (lot 6 de l'audit du 2026-09-23) — voir api-guards.ts.
    const heavy = await enforceUserRateLimit(
      auth.store,
      'history:write-bytes',
      auth.user.id,
      new Date(),
      body.bytes,
    );
    if (heavy) return heavy;

    const db = createDb(context.env.DATABASE_URL);
    const userId = auth.user.id;
    // Validation PAR ENTRÉE (entrées invalides ignorées, listées dans `rejected`), références,
    // quota, écriture : voir server/history/batch.ts.
    const outcome = await processHistoryBatch(
      body.value,
      new Date(),
      { parse: parseTradesBatch, quotaLabel: "d'échanges", quota: MAX_TRADES_PER_ACCOUNT },
      {
        loadKnownReferences: (entries) => loadKnownReferences(db, entries),
        withinQuota: (keys) => checkHistoryQuota(db, trades, userId, keys, MAX_TRADES_PER_ACCOUNT),
        ingest: (entries) => ingestTrades(db, userId, entries),
        storage: historyStorageDeps(db, trades, userId, context.env.HISTORY_STORAGE_CEILING_MB),
      },
    );
    return json(outcome.body, outcome.status);
  } catch (error) {
    // Jamais le message Postgres au client : journalisé côté serveur, 500 générique.
    return internalErrorResponse('history/trades POST', error);
  }
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
