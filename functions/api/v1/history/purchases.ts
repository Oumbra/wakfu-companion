import type { PagesFunction } from '@cloudflare/workers-types';
import { and, desc, eq, lt } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { purchases } from '../../../../server/db/schema';
import {
  MAX_HISTORY_BATCH,
  parsePageQuery,
  parsePurchasesBatch,
} from '../../../../server/history/parse';
import { ingestPurchases } from '../../../../server/history/ingest';
import {
  MAX_PURCHASES_PER_ACCOUNT,
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
 * Historique d'achats du compte (lot 8, prompt 8.1). L'écriture idempotente vit dans
 * `server/history/ingest.ts::ingestPurchases` (voir sa doc) — ce handler ne fait que
 * l'authentification, la validation du corps et la réponse HTTP.
 */

const MAX_PAYLOAD_BYTES = 512 * 1024;

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
      { parse: parsePurchasesBatch, quotaLabel: "d'achats", quota: MAX_PURCHASES_PER_ACCOUNT },
      {
        loadKnownReferences: (entries) => loadKnownReferences(db, entries),
        withinQuota: (keys) =>
          checkHistoryQuota(db, purchases, userId, keys, MAX_PURCHASES_PER_ACCOUNT),
        ingest: (entries) => ingestPurchases(db, userId, entries),
        storage: historyStorageDeps(db, purchases, userId, context.env.HISTORY_STORAGE_CEILING_MB),
      },
    );
    return json(outcome.body, outcome.status);
  } catch (error) {
    // Jamais le message Postgres au client : journalisé côté serveur, 500 générique.
    return internalErrorResponse('history/purchases POST', error);
  }
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
