import type { PagesFunction } from '@cloudflare/workers-types';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { pactExtractionItems, pactExtractions } from '../../../../server/db/schema';
import {
  MAX_HISTORY_BATCH,
  parsePactExtractionsBody,
  parsePageQuery,
} from '../../../../server/history/parse';
import { ingestPactExtractions } from '../../../../server/history/ingest';
import { checkHistoryReferences } from '../../../../server/history/guards';
import { readJsonBodyLimited } from '../../../../server/http/body';
import { enforceUserRateLimit, internalErrorResponse } from '../../../../server/http/api-guards';
import { authenticate, json, jsonError, requireCsrf, unauthenticated } from '../../_auth';
import type { Env } from '../../_types';

/**
 * Historique d'extractions de pacte du compte — même séquence en trois temps que les combats/
 * échanges (`insert` → `select` → `insert` des lignes filles) et pour la même raison : faute de
 * transaction avec le driver `neon-http`, seule une écriture des filles indépendante de la question
 * « le parent vient-il d'être créé ? » se répare toute seule au rejeu. Voir
 * `server/history/ingest.ts` pour le détail (`ingestTrades` est le gabarit le plus proche : une
 * extraction de pacte n'a qu'un seul "côté", contrairement à un échange).
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

    const parsed = parsePactExtractionsBody(body.value);
    if (!parsed.ok) return jsonError(parsed.error, 400);
    if (parsed.value.length === 0) return json({ accepted: [], inserted: 0 });

    const db = createDb(context.env.DATABASE_URL);
    // Références inconnues ⇒ 400 plutôt qu'une violation de clé étrangère en 500 (guards.ts).
    const unknownReference = await checkHistoryReferences(db, parsed.value);
    if (unknownReference) return jsonError(unknownReference, 400);
    return json(await ingestPactExtractions(db, auth.user.id, parsed.value));
  } catch (error) {
    // Jamais le message Postgres au client : journalisé côté serveur, 500 générique.
    return internalErrorResponse('history/pacts POST', error);
  }
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
