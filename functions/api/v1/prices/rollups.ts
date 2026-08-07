import type { PagesFunction } from '@cloudflare/workers-types';
import { eq, inArray, sql } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { gameServers, items, itemPricesMonthly, priceTrends } from '../../../../server/db/schema';
import { checkPriceServiceToken } from '../../_price-auth';
import type { Env } from '../../_types';

interface MonthlyRow {
  itemId: number;
  month: string;
  priceMin: number;
  priceMax: number;
  priceAvg: number;
  samplesCount: number;
}

interface TrendRow {
  itemId: number;
  avgLast30d: number;
  avgPrev30d: number;
  changePct: number;
}

interface RollupsBody {
  gameServer: string;
  monthly: MonthlyRow[];
  trends: TrendRow[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BATCH_SIZE = 500;

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function isMonthlyRow(v: unknown): v is MonthlyRow {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['itemId'] === 'number' &&
    typeof r['month'] === 'string' &&
    DATE_RE.test(r['month']) &&
    typeof r['priceMin'] === 'number' &&
    typeof r['priceMax'] === 'number' &&
    typeof r['priceAvg'] === 'number' &&
    typeof r['samplesCount'] === 'number'
  );
}

function isTrendRow(v: unknown): v is TrendRow {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['itemId'] === 'number' &&
    typeof r['avgLast30d'] === 'number' &&
    typeof r['avgPrev30d'] === 'number' &&
    typeof r['changePct'] === 'number'
  );
}

/** Valide la forme du corps envoyé par le skill de calcul de trends (voir doc de section dans
 * server/db/schema.ts) : {gameServer, monthly: [...], trends: [...]}. */
export function parseRollupsBody(body: unknown): { error: string } | { data: RollupsBody } {
  if (typeof body !== 'object' || body === null) return { error: 'corps JSON invalide' };
  const b = body as Record<string, unknown>;

  if (typeof b['gameServer'] !== 'string' || b['gameServer'].length === 0) {
    return { error: 'gameServer manquant ou invalide' };
  }
  if (!Array.isArray(b['monthly']) || !b['monthly'].every(isMonthlyRow)) {
    return {
      error:
        'monthly[] doit contenir des entrées {itemId, month, priceMin, priceMax, priceAvg, samplesCount}',
    };
  }
  if (!Array.isArray(b['trends']) || !b['trends'].every(isTrendRow)) {
    return {
      error: 'trends[] doit contenir des entrées {itemId, avgLast30d, avgPrev30d, changePct}',
    };
  }

  return {
    data: {
      gameServer: b['gameServer'],
      monthly: b['monthly'] as MonthlyRow[],
      trends: b['trends'] as TrendRow[],
    },
  };
}

// POST /api/v1/prices/rollups — reçoit les agrégats calculés par le skill de trends (lot 4, prompt
// 4.2 : item_prices_monthly du mois courant + price_trends, calculés en local à partir de
// GET /prices/export, PAS côté serveur — voir server/db/schema.ts). Protégé par le même jeton de
// service que /prices/ingest (voir _price-auth.ts). Un itemId absent du catalogue est REJETÉ
// explicitement (jamais silencieusement ignoré, même règle que /prices/ingest) : exclu des upserts,
// listé dans la réponse.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const authError = checkPriceServiceToken(context.request, context.env);
  if (authError) return authError;

  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return jsonError('corps JSON invalide', 400);
  }

  const parsed = parseRollupsBody(rawBody);
  if ('error' in parsed) return jsonError(parsed.error, 400);
  const { gameServer, monthly, trends } = parsed.data;

  const db = createDb(context.env.DATABASE_URL);

  const [server] = await db
    .select({ code: gameServers.code })
    .from(gameServers)
    .where(eq(gameServers.code, gameServer))
    .limit(1);
  if (!server) return jsonError(`serveur de jeu inconnu : "${gameServer}"`, 400);

  const distinctItemIds = [
    ...new Set([...monthly.map((r) => r.itemId), ...trends.map((r) => r.itemId)]),
  ];
  const knownRows =
    distinctItemIds.length > 0
      ? await db
          .select({ ankamaId: items.ankamaId })
          .from(items)
          .where(inArray(items.ankamaId, distinctItemIds))
      : [];
  const knownItemIds = new Set(knownRows.map((row) => row.ankamaId));

  const acceptedMonthly = monthly.filter((r) => knownItemIds.has(r.itemId));
  const rejectedMonthlyIds = [
    ...new Set(monthly.filter((r) => !knownItemIds.has(r.itemId)).map((r) => r.itemId)),
  ];
  const acceptedTrends = trends.filter((r) => knownItemIds.has(r.itemId));
  const rejectedTrendIds = [
    ...new Set(trends.filter((r) => !knownItemIds.has(r.itemId)).map((r) => r.itemId)),
  ];

  for (let i = 0; i < acceptedMonthly.length; i += BATCH_SIZE) {
    const batch = acceptedMonthly.slice(i, i + BATCH_SIZE).map((r) => ({
      itemId: r.itemId,
      gameServer,
      month: r.month,
      priceMin: r.priceMin,
      priceMax: r.priceMax,
      priceAvg: r.priceAvg,
      samplesCount: r.samplesCount,
    }));
    await db
      .insert(itemPricesMonthly)
      .values(batch)
      .onConflictDoUpdate({
        target: [itemPricesMonthly.itemId, itemPricesMonthly.gameServer, itemPricesMonthly.month],
        set: {
          priceMin: sql`excluded.price_min`,
          priceMax: sql`excluded.price_max`,
          priceAvg: sql`excluded.price_avg`,
          samplesCount: sql`excluded.samples_count`,
        },
      });
  }

  for (let i = 0; i < acceptedTrends.length; i += BATCH_SIZE) {
    const batch = acceptedTrends.slice(i, i + BATCH_SIZE).map((r) => ({
      itemId: r.itemId,
      gameServer,
      avgLast30d: r.avgLast30d,
      avgPrev30d: r.avgPrev30d,
      changePct: r.changePct,
    }));
    await db
      .insert(priceTrends)
      .values(batch)
      .onConflictDoUpdate({
        target: [priceTrends.itemId, priceTrends.gameServer],
        set: {
          avgLast30d: sql`excluded.avg_last_30d`,
          avgPrev30d: sql`excluded.avg_prev_30d`,
          changePct: sql`excluded.change_pct`,
          updatedAt: sql`now()`,
        },
      });
  }

  return new Response(
    JSON.stringify({
      monthlyAccepted: acceptedMonthly.length,
      monthlyRejected: rejectedMonthlyIds,
      trendsAccepted: acceptedTrends.length,
      trendsRejected: rejectedTrendIds,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};
