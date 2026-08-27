import type { PagesFunction } from '@cloudflare/workers-types';
import { and, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import {
  fightLoot,
  fightParticipants,
  fights,
  monsters,
  purchases,
  trades,
} from '../../../../server/db/schema';
import { HDV_KAMAS_SALE_ITEM, parseStatsQuery } from '../../../../server/history/stats-query';
import { authenticate, json, jsonError, unauthenticated } from '../../_auth';
import type { Env } from '../../_types';

/**
 * Agrégation par période de l'historique du compte (combats, achats, échanges) — carte Récap,
 * switch Session/Jour/Mois/Année + regroupement Donjon & Famille/Type. `GET` uniquement : cette
 * route ne fait que sommer ce que `POST /api/v1/history/{fights,purchases,trades}` a déjà ingéré,
 * aucune écriture ici.
 *
 * Bornes fournies par le CLIENT (`since`/`until`, instants ISO), jamais un paramètre
 * `granularity` interprété côté serveur — voir `server/history/stats-query.ts` : le calcul
 * "premier jour du mois civil" dépend du fuseau horaire de l'utilisateur, que seul le navigateur
 * connaît (voir `core/utils/local-period.util.ts`).
 *
 * Douze `SELECT` indépendants (pas de transaction requise, driver `neon-http` déjà sans
 * transaction interactive — voir server/README.md), lancés en parallèle : un même combat/achat/
 * échange n'est jamais compté deux fois puisque chaque requête porte sur une seule table (+ une
 * jointure en lecture seule pour XP/butin/donjon/famille), toutes filtrées par le même
 * `(userId, plage)`.
 *
 * `dungeonRuns` (par donjon uniquement, absent des groupes `families`) : un donjon est un
 * REGROUPEMENT de combats (salles + tentatives de boss), jamais un simple décompte de combats — un
 * clear de donjon 4 salles produit 4 lignes dans `fights` pour UN SEUL donjon "fait". Approximé ici
 * par le nombre de combats DISTINCTS de la période où un monstre `is_boss` est présent côté ennemi
 * (`dungeonBossFightRows` ci-dessous) : chaque tentative contre le boss (gagnée ou perdue) ancre
 * exactement une entrée de run au sens de `groupDungeonRuns` (core/utils/dungeon-run-grouping.util.ts),
 * à une approximation acceptée près — plusieurs tentatives PERDANTES consécutives contre le même
 * boss avant une victoire finale sont fusionnées en un seul run côté client (`groupDungeonRuns`)
 * mais comptées ici comme autant de runs distincts (pas de fenêtre temporelle de clustering
 * reproduite côté SQL, qui nécessiterait de rejouer tout l'historique ordonné plutôt qu'un simple
 * agrégat). Les donjons à un seul combat (3 joueurs, boss ultime...) ont par construction
 * `dungeonRuns === fights`, aucune approximation ne s'y applique.
 *
 * Le regroupement par donjon ne rejoint PAS `dungeons` : `dungeonId` est renvoyé brut (id Ankama)
 * et résolu en nom localisé côté client via `CatalogService` (même principe que `itemId`/
 * `itemName` du butin ci-dessous — le serveur ne connaît pas la locale d'affichage de
 * l'utilisateur, voir CLAUDE.md). Les combats HORS DONJON (`dungeonId IS NULL`) n'apparaissent
 * plus dans `dungeons` (filtrés) : ils sont regroupés à la place par FAMILLE de monstre
 * représentative dans `families` (`familyId: null` = famille inconnue/monstre non catalogué,
 * toutes ces occurrences fusionnées dans une seule ligne).
 *
 * "Famille représentative d'un combat hors donjon" : sous-requête dérivée (`familyPerFight`,
 * réutilisée par `families`/`familyLoot`/`familyXp` ci-dessous, jamais matérialisée seule) —
 * reproduit côté SQL la même priorité que `resolveFightImageInfo`/`resolveFightTypeClassification`
 * (client, fight-image.util.ts) : boss > archimonstre > dominant > plus gros dégât, à UNE
 * approximation près acceptée (voir CLAUDE.md) : le repli générique "horde hétérogène >3 familles"
 * de la version client n'est pas reproduit ici, ces combats tombent simplement dans la famille du
 * participant le mieux classé. `DISTINCT ON` (Postgres) plutôt qu'un `ROW_NUMBER() OVER` + filtre :
 * plus direct pour "une ligne par fight_id, la mieux classée" ; pas de support `selectDistinctOn`
 * dans la version de drizzle-orm utilisée ici (pg-core), d'où un `db.execute(sql\`...\`)` brut pour
 * les 3 requêtes qui en dépendent plutôt qu'un enchaînement de query builder Drizzle.
 */
function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value);
}

interface GroupTotalsRow {
  fights: number;
  /** Toujours 0 pour un groupe `families` (voir doc de tête) — seuls les groupes `dungeons` le
   * renseignent réellement. */
  dungeonRuns: number;
  won: number;
  lost: number;
  kamasGained: number;
  xpGained: number;
  xpByCharacter: { name: string; amount: number }[];
  loot: { itemId: number | null; itemName: string | null; quantity: number }[];
}

function emptyGroupTotals(): GroupTotalsRow {
  return {
    fights: 0,
    dungeonRuns: 0,
    won: 0,
    lost: 0,
    kamasGained: 0,
    xpGained: 0,
    xpByCharacter: [],
    loot: [],
  };
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();

  const query = parseStatsQuery(new URL(context.request.url).searchParams);
  if (!query.ok) return jsonError(query.error, 400);
  const { since, until } = query.value;

  const db = createDb(context.env.DATABASE_URL);
  const userId = auth.user.id;

  // Sous-requête dérivée "famille représentative par combat hors-donjon" (voir doc de tête) —
  // fragment `sql` réutilisé (interpolé, pas exécuté seul) par les 3 requêtes `family*` ci-dessous.
  const familyPerFight = sql`
    select distinct on (fp.fight_id) fp.fight_id as fight_id, m.family as family
    from fight_participants fp
    join monsters m on m.id = fp.monster_id
    join fights f on f.id = fp.fight_id
    where f.user_id = ${userId}
      and f.started_at >= ${since}
      and f.started_at < ${until}
      and f.dungeon_id is null
      and fp.side = 'enemy'
      and fp.monster_id is not null
    order by fp.fight_id,
      case when m.is_boss then 0 when m.is_archi then 1 when m.is_dominant then 2 else 3 end,
      fp.damage desc
  `;

  const [
    fightTotals,
    xpRows,
    lootRows,
    purchaseTotals,
    tradeTotals,
    dungeonRows,
    dungeonLootRows,
    dungeonXpRows,
    dungeonBossFightRows,
    familyTotalsResult,
    familyLootResult,
    familyXpResult,
  ] = await Promise.all([
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
        and(eq(trades.userId, userId), gte(trades.occurredAt, since), lt(trades.occurredAt, until)),
      ),

    // Regroupement par donjon — hors donjon (dungeonId null) exclu ici, voir `families` plus bas.
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
        and(
          eq(fights.userId, userId),
          gte(fights.startedAt, since),
          lt(fights.startedAt, until),
          isNotNull(fights.dungeonId),
        ),
      )
      .groupBy(fights.dungeonId)
      .orderBy(desc(sql`count(*)`)),

    db
      .select({
        dungeonId: fights.dungeonId,
        itemId: fightLoot.itemId,
        itemName: fightLoot.itemName,
        quantity: sql<number>`coalesce(sum(${fightLoot.quantity}), 0)`,
      })
      .from(fightLoot)
      .innerJoin(fights, eq(fightLoot.fightId, fights.id))
      .where(
        and(
          eq(fights.userId, userId),
          gte(fights.startedAt, since),
          lt(fights.startedAt, until),
          isNotNull(fights.dungeonId),
        ),
      )
      .groupBy(fights.dungeonId, fightLoot.itemId, fightLoot.itemName),

    db
      .select({
        dungeonId: fights.dungeonId,
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
          isNotNull(fights.dungeonId),
        ),
      )
      .groupBy(fights.dungeonId, fightParticipants.name),

    // Nombre de "donjons" (voir doc de tête, `dungeonRuns`) : combats DISTINCTS où un monstre
    // `is_boss` apparaît côté ennemi, groupés par donjon.
    db
      .select({
        dungeonId: fights.dungeonId,
        runs: sql<number>`count(distinct ${fights.id})`,
      })
      .from(fights)
      .innerJoin(fightParticipants, eq(fightParticipants.fightId, fights.id))
      .innerJoin(monsters, eq(monsters.id, fightParticipants.monsterId))
      .where(
        and(
          eq(fights.userId, userId),
          gte(fights.startedAt, since),
          lt(fights.startedAt, until),
          isNotNull(fights.dungeonId),
          eq(fightParticipants.side, 'enemy'),
          eq(monsters.isBoss, true),
        ),
      )
      .groupBy(fights.dungeonId),

    db.execute(sql`
      select ff.family as family,
        count(*) as fights_count,
        count(*) filter (where f.won = true) as won,
        count(*) filter (where f.won = false) as lost,
        coalesce(sum(f.kamas_gained), 0) as kamas_gained,
        coalesce(sum(f.xp_gained), 0) as xp_gained
      from fights f
      join (${familyPerFight}) ff on ff.fight_id = f.id
      group by ff.family
      order by count(*) desc
    `),

    db.execute(sql`
      select ff.family as family, fl.item_id as item_id, fl.item_name as item_name,
        coalesce(sum(fl.quantity), 0) as quantity
      from fight_loot fl
      join (${familyPerFight}) ff on ff.fight_id = fl.fight_id
      group by ff.family, fl.item_id, fl.item_name
    `),

    db.execute(sql`
      select ff.family as family, fp.name as name, coalesce(sum(fp.xp_gained), 0) as amount
      from fight_participants fp
      join (${familyPerFight}) ff on ff.fight_id = fp.fight_id
      where fp.side = 'ally'
      group by ff.family, fp.name
    `),
  ]);

  const fightRow = fightTotals[0];
  const purchaseRow = purchaseTotals[0];
  const tradeRow = tradeTotals[0];

  // --- Assemblage des groupes "donjon" et "famille" : chacun démarre de sa requête de totaux
  // (fights/won/lost/kamasGained/xpGained), puis se voit greffer sa ventilation loot/xp propre —
  // reconstruite ici plutôt que côté SQL (jointure directe aurait multiplié les lignes de totaux
  // par le nombre de lignes de butin/XP, faussant les sommes).
  const dungeonGroups = new Map<number, GroupTotalsRow & { dungeonId: number }>();
  for (const row of dungeonRows) {
    // isNotNull(fights.dungeonId) garantit dungeonId non-null ici — cast nécessaire, Drizzle ne
    // rétrécit pas le type de la colonne à partir d'une clause WHERE.
    const dungeonId = row.dungeonId as number;
    dungeonGroups.set(dungeonId, {
      dungeonId,
      fights: num(row.fightsCount),
      dungeonRuns: 0, // complété par dungeonBossFightRows ci-dessous, resté à 0 sans tentative de boss sur la période
      won: num(row.won),
      lost: num(row.lost),
      kamasGained: num(row.kamasGained),
      xpGained: num(row.xpGained),
      xpByCharacter: [],
      loot: [],
    });
  }
  for (const row of dungeonBossFightRows) {
    const group = dungeonGroups.get(row.dungeonId as number);
    if (group) group.dungeonRuns = num(row.runs);
  }
  for (const row of dungeonXpRows) {
    const group = dungeonGroups.get(row.dungeonId as number);
    if (group) group.xpByCharacter.push({ name: row.name, amount: num(row.amount) });
  }
  for (const row of dungeonLootRows) {
    const group = dungeonGroups.get(row.dungeonId as number);
    if (group) {
      group.loot.push({ itemId: row.itemId, itemName: row.itemName, quantity: num(row.quantity) });
    }
  }

  const familyGroups = new Map<number | null, GroupTotalsRow & { familyId: number | null }>();
  for (const row of familyTotalsResult.rows as Record<string, unknown>[]) {
    const familyId = numOrNull(row['family']);
    familyGroups.set(familyId, {
      familyId,
      fights: num(row['fights_count']),
      dungeonRuns: 0, // sans objet hors donjon (voir doc de tête) — le client retombe sur `fights`
      won: num(row['won']),
      lost: num(row['lost']),
      kamasGained: num(row['kamas_gained']),
      xpGained: num(row['xp_gained']),
      xpByCharacter: [],
      loot: [],
    });
  }
  for (const row of familyXpResult.rows as Record<string, unknown>[]) {
    const familyId = numOrNull(row['family']);
    const group = familyGroups.get(familyId);
    if (group) {
      group.xpByCharacter.push({ name: row['name'] as string, amount: num(row['amount']) });
    }
  }
  for (const row of familyLootResult.rows as Record<string, unknown>[]) {
    const familyId = numOrNull(row['family']);
    const group = familyGroups.get(familyId);
    if (group) {
      group.loot.push({
        itemId: numOrNull(row['item_id']),
        itemName: (row['item_name'] as string | null) ?? null,
        quantity: num(row['quantity']),
      });
    }
  }

  return json({
    since: since.toISOString(),
    until: until.toISOString(),
    combats: {
      won: num(fightRow.won),
      lost: num(fightRow.lost),
      challengesPassed: num(fightRow.challengesPassed),
      challengesFailed: num(fightRow.challengesFailed),
    },
    kamas: {
      fromCombat: num(fightRow.kamasFromCombat),
      fromHdvSales: num(purchaseRow.fromHdvSales),
      spentOnPurchases: num(purchaseRow.spentOnPurchases),
      tradesAcquired: num(tradeRow.tradesAcquired),
      tradesGiven: num(tradeRow.tradesGiven),
      tradeCount: num(tradeRow.tradeCount),
    },
    xpByCharacter: xpRows.map((row) => ({ name: row.name, amount: num(row.amount) })),
    loot: lootRows.map((row) => ({
      itemId: row.itemId,
      itemName: row.itemName,
      quantity: num(row.quantity),
    })),
    dungeons: Array.from(dungeonGroups.values()),
    families: Array.from(familyGroups.values()),
  });
};
