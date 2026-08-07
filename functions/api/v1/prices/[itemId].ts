import type { PagesFunction } from '@cloudflare/workers-types';
import { and, asc, eq, gte } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { itemPricesDaily, itemPricesMonthly } from '../../../../server/db/schema';
import type { Env } from '../../_types';

/** `range` -> nombre de mois d'historique mensuel renvoyés (voir prompt 4.3, sélecteur de plage).
 * La courbe quotidienne, elle, est TOUJOURS bornée au mois courant, indépendamment de `range` —
 * voir doc de onRequestGet. Borné à 60 mois (5 ans) même pour "all" : endpoint public, doit rester
 * rapide (prompt 4.2, "endpoints publics bornés"), et cette profondeur est déjà trois fois le
 * budget réaliste des toutes premières années de collecte. */
const RANGE_TO_MONTHS: Readonly<Record<string, number>> = {
  '3m': 3,
  '6m': 6,
  '1y': 12,
  '2y': 24,
  all: 60,
};
const DEFAULT_RANGE = '1y';

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function currentMonthStart(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function monthsAgo(months: number): string {
  const d = new Date();
  d.setUTCDate(1); // évite un débordement de mois lors de la soustraction (ex. 31 mars - 1 mois)
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

// GET /api/v1/prices/{itemId}?server=&range= — série de prix d'un objet pour un serveur donné,
// endpoint PUBLIC (aucun jeton requis, contrairement à /prices/ingest|export|rollups — voir
// _price-auth.ts). Deux séries dans la réponse (prompt 4.3) :
//   - `daily` : prix quotidien du MOIS COURANT uniquement (courbe fine, indépendante de `range`) ;
//   - `monthly` : historique mensuel (min/max/moyenne), borné par `range` (voir RANGE_TO_MONTHS).
// Ne renvoie JAMAIS d'erreur pour un objet/serveur sans aucune donnée : tableaux vides — c'est
// l'état "jamais scanné" (voir prompt 4.3 point 5, à distinguer explicitement côté UI d'un
// serveur sans données ou d'un mois partiellement couvert via `samplesCount`).
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const itemId = Number(context.params['itemId']);
  if (!Number.isInteger(itemId)) return jsonError('itemId invalide', 400);

  const url = new URL(context.request.url);
  const server = url.searchParams.get('server');
  if (!server) return jsonError('paramètre "server" requis', 400);

  const rangeParam = url.searchParams.get('range') ?? DEFAULT_RANGE;
  const rangeMonths = RANGE_TO_MONTHS[rangeParam];
  if (!rangeMonths) {
    return jsonError(
      `paramètre "range" invalide (attendu ${Object.keys(RANGE_TO_MONTHS).join('|')})`,
      400,
    );
  }

  const db = createDb(context.env.DATABASE_URL);

  const [daily, monthly] = await Promise.all([
    db
      .select({ capturedOn: itemPricesDaily.capturedOn, price: itemPricesDaily.price })
      .from(itemPricesDaily)
      .where(
        and(
          eq(itemPricesDaily.itemId, itemId),
          eq(itemPricesDaily.gameServer, server),
          gte(itemPricesDaily.capturedOn, currentMonthStart()),
        ),
      )
      .orderBy(asc(itemPricesDaily.capturedOn)),
    db
      .select({
        month: itemPricesMonthly.month,
        priceMin: itemPricesMonthly.priceMin,
        priceMax: itemPricesMonthly.priceMax,
        priceAvg: itemPricesMonthly.priceAvg,
        samplesCount: itemPricesMonthly.samplesCount,
      })
      .from(itemPricesMonthly)
      .where(
        and(
          eq(itemPricesMonthly.itemId, itemId),
          eq(itemPricesMonthly.gameServer, server),
          gte(itemPricesMonthly.month, monthsAgo(rangeMonths)),
        ),
      )
      .orderBy(asc(itemPricesMonthly.month)),
  ]);

  return new Response(JSON.stringify({ itemId, gameServer: server, daily, monthly }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
