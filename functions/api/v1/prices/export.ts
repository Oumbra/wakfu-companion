import type { PagesFunction } from '@cloudflare/workers-types';
import { and, eq, gte } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { itemPricesDaily } from '../../../../server/db/schema';
import { checkPriceServiceToken } from '../../_price-auth';
import type { Env } from '../../_types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Fenêtre par défaut si `since` est omis : couvre exactement le besoin du skill de trends
 * (moyenne des 30 derniers jours vs des 30 jours précédents, voir price_trends dans
 * server/db/schema.ts) sans obliger l'appelant à le recalculer lui-même à chaque appel. */
const DEFAULT_LOOKBACK_DAYS = 60;

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function defaultSince(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - DEFAULT_LOOKBACK_DAYS);
  return d.toISOString().slice(0, 10);
}

// GET /api/v1/prices/export?server=&since= — export brut de item_prices_daily pour un serveur de
// jeu, protégé par jeton de service statique (voir _price-auth.ts) : endpoint opérationnel destiné
// au skill de calcul de trends (lot 4, prompt 4.2 — architecture actée avec l'utilisateur : le
// calcul de price_trends/item_prices_monthly vit dans un skill local, PAS côté serveur), jamais
// appelé par le navigateur d'un joueur — voir GET /prices/{itemId} pour l'endpoint public borné.
// `since` par défaut à J-60 (fenêtre 30j/30j nécessaire au calcul de tendance) ; peut être élargi
// explicitement par l'appelant (ex. reconstruction complète d'un rollup mensuel).
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const authError = checkPriceServiceToken(context.request, context.env);
  if (authError) return authError;

  const url = new URL(context.request.url);
  const server = url.searchParams.get('server');
  if (!server) return jsonError('paramètre "server" requis', 400);

  const since = url.searchParams.get('since') ?? defaultSince();
  if (!DATE_RE.test(since))
    return jsonError('paramètre "since" invalide (attendu AAAA-MM-JJ)', 400);

  const db = createDb(context.env.DATABASE_URL);
  const rows = await db
    .select({
      itemId: itemPricesDaily.itemId,
      capturedOn: itemPricesDaily.capturedOn,
      price: itemPricesDaily.price,
      priceMax: itemPricesDaily.priceMax,
    })
    .from(itemPricesDaily)
    .where(and(eq(itemPricesDaily.gameServer, server), gte(itemPricesDaily.capturedOn, since)));

  return new Response(JSON.stringify({ gameServer: server, since, rows }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
