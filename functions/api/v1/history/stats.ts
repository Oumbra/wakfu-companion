import type { PagesFunction } from '@cloudflare/workers-types';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import {
  fightLoot,
  fightParticipants,
  fights,
  purchases,
  trades,
} from '../../../../server/db/schema';
import { HDV_KAMAS_SALE_ITEM, parseStatsQuery } from '../../../../server/history/stats-query';
import { authenticate, json, jsonError, unauthenticated } from '../../_auth';
import type { Env } from '../../_types';

/**
 * Agrégation par période de l'historique du compte (combats, achats, échanges) — carte Récap,
 * switch Session/Jour/Mois/Année. `GET` uniquement : cette route ne fait que sommer ce que
 * `POST /api/v1/history/{fights,purchases,trades}` a déjà ingéré, aucune écriture ici.
 *
 * Bornes fournies par le CLIENT (`since`/`until`, instants ISO), jamais un paramètre
 * `granularity` interprété côté serveur — voir `server/history/stats-query.ts` : le calcul
 * "premier jour du mois civil" dépend du fuseau horaire de l'utilisateur, que seul le navigateur
 * connaît (voir `core/utils/local-period.util.ts`).
 *
 * Six `SELECT` indépendants (pas de transaction requise, driver `neon-http` déjà sans
 * transaction interactive — voir server/README.md), lancés en parallèle : un même combat/achat/
 * échange n'est jamais compté deux fois puisque chaque requête porte sur une seule table (+ une
 * jointure en lecture seule pour XP/butin/donjon), toutes filtrées par le même `(userId, plage)`.
 *
 * Le regroupement par donjon (6e requête) ne rejoint PAS `dungeons` : `dungeonId` est renvoyé brut
 * (id Ankama, `null` = hors donjon) et résolu en nom localisé côté client via `CatalogService`
 * (même principe que `itemId`/`itemName` du butin ci-dessous — le serveur ne connaît pas la
 * locale d'affichage de l'utilisateur, voir CLAUDE.md). Aucune migration requise : `fights.dungeonId`
 * existe déjà (lot 8, alimenté par `HistorySyncService` à l'ingestion).
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();

  const query = parseStatsQuery(new URL(context.request.url).searchParams);
  if (!query.ok) return jsonError(query.error, 400);
  const { since, until } = query.value;

  const db = createDb(context.env.DATABASE_URL);
  const userId = auth.user.id;

  const [fightTotals, xpRows, lootRows, purchaseTotals, tradeTotals, dungeonRows] =
    await Promise.all([
      db
        .select({
          won: sql<number>`count(*) filter (where ${fights.won} = true)`,
          lost: sql<number>`count(*) filter (where ${fights.won} = false)`,
          challengesPassed: sql<number>`coalesce(sum(${fights.challengesPassed}), 0)`,
          challengesFailed: sql<number>`coalesce(sum(${fights.challengesFailed}), 0)`,
          kamasFromCombat: sql<number>`coalesce(sum(${fights.kamasGained}), 0)`,
        })
        .from(fights)
        .where(
          and(eq(fights.userId, userId), gte(fights.startedAt, since), lt(fights.startedAt, until)),
        ),

      db
        .select({
          name: fightParticipants.name,
          amount: sql<number>`coalesce(sum(${fightParticipants.xpGained}), 0)`,
        })
        .from(fightParticipants)
        .innerJoin(fights, eq(fightParticipants.fightId, fights.id))
        .where(
          and(
            eq(fights.userId, userId),
            gte(fights.startedAt, since),
            lt(fights.startedAt, until),
            eq(fightParticipants.side, 'ally'),
          ),
        )
        .groupBy(fightParticipants.name)
        .orderBy(desc(sql`sum(${fightParticipants.xpGained})`)),

      db
        .select({
          itemId: fightLoot.itemId,
          itemName: fightLoot.itemName,
          quantity: sql<number>`coalesce(sum(${fightLoot.quantity}), 0)`,
        })
        .from(fightLoot)
        .innerJoin(fights, eq(fightLoot.fightId, fights.id))
        .where(
          and(eq(fights.userId, userId), gte(fights.startedAt, since), lt(fights.startedAt, until)),
        )
        // itemId/itemName mutuellement exclusifs (voir server/db/schema.ts) : grouper sur les deux
        // revient à grouper sur celui des deux qui est renseigné pour chaque ligne.
        .groupBy(fightLoot.itemId, fightLoot.itemName),

      db
        .select({
          // Une vente HDV (sentinelle HDV_KAMAS_SALE_ITEM) et un vrai achat partagent la même table
          // et le même signe de total_cost (toujours positif côté client) — seul item_name distingue
          // un gain d'une dépense, voir la doc de HDV_KAMAS_SALE_ITEM.
          spentOnPurchases: sql<number>`coalesce(sum(${purchases.totalCost}) filter (where ${purchases.itemName} is distinct from ${HDV_KAMAS_SALE_ITEM}), 0)`,
          fromHdvSales: sql<number>`coalesce(sum(${purchases.totalCost}) filter (where ${purchases.itemName} = ${HDV_KAMAS_SALE_ITEM}), 0)`,
        })
        .from(purchases)
        .where(
          and(
            eq(purchases.userId, userId),
            gte(purchases.occurredAt, since),
            lt(purchases.occurredAt, until),
          ),
        ),

      db
        .select({
          tradesAcquired: sql<number>`coalesce(sum(${trades.kamasAcquired}), 0)`,
          tradesGiven: sql<number>`coalesce(sum(${trades.kamasGiven}), 0)`,
          tradeCount: sql<number>`count(*)`,
        })
        .from(trades)
        .where(
          and(
            eq(trades.userId, userId),
            gte(trades.occurredAt, since),
            lt(trades.occurredAt, until),
          ),
        ),

      db
        .select({
          dungeonId: fights.dungeonId,
          fightsCount: sql<number>`count(*)`,
          won: sql<number>`count(*) filter (where ${fights.won} = true)`,
          lost: sql<number>`count(*) filter (where ${fights.won} = false)`,
          kamasGained: sql<number>`coalesce(sum(${fights.kamasGained}), 0)`,
          xpGained: sql<number>`coalesce(sum(${fights.xpGained}), 0)`,
        })
        .from(fights)
        .where(
          and(eq(fights.userId, userId), gte(fights.startedAt, since), lt(fights.startedAt, until)),
        )
        .groupBy(fights.dungeonId)
        .orderBy(desc(sql`count(*)`)),
    ]);

  const fightRow = fightTotals[0];
  const purchaseRow = purchaseTotals[0];
  const tradeRow = tradeTotals[0];

  return json({
    since: since.toISOString(),
    until: until.toISOString(),
    combats: {
      won: fightRow.won,
      lost: fightRow.lost,
      challengesPassed: fightRow.challengesPassed,
      challengesFailed: fightRow.challengesFailed,
    },
    kamas: {
      fromCombat: fightRow.kamasFromCombat,
      fromHdvSales: purchaseRow.fromHdvSales,
      spentOnPurchases: purchaseRow.spentOnPurchases,
      tradesAcquired: tradeRow.tradesAcquired,
      tradesGiven: tradeRow.tradesGiven,
      tradeCount: tradeRow.tradeCount,
    },
    xpByCharacter: xpRows.map((row) => ({ name: row.name, amount: row.amount })),
    loot: lootRows.map((row) => ({
      itemId: row.itemId,
      itemName: row.itemName,
      quantity: row.quantity,
    })),
    dungeons: dungeonRows.map((row) => ({
      dungeonId: row.dungeonId,
      fights: row.fightsCount,
      won: row.won,
      lost: row.lost,
      kamasGained: row.kamasGained,
      xpGained: row.xpGained,
    })),
  });
};
