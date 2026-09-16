import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  fightLoot,
  fightParticipants,
  fights,
  pactExtractionItems,
  pactExtractions,
  purchases,
  tradeItems,
  trades,
} from '../db/schema';
import { loadCatalogFromDb, recomputeDungeonRunsForBatch } from './dungeon-run';
import {
  dungeonFightTypeUpdateSql,
  eventFightTypeUpdateSql,
  familyFightTypeUpdateSql,
} from './fight-type';
import type { FightInput, PactExtractionInput, PurchaseInput, TradeInput } from './parse';

/**
 * Ingestion idempotente de l'historique d'un compte — le cœur des quatre `POST /api/v1/history/*`
 * (`functions/api/v1/history/{fights,purchases,trades,pacts}.ts`), sorti des handlers pour être
 * rejouable HORS requête HTTP : le script de support `server/import/replay-user-history.ts`
 * réinjecte pour un compte donné exactement ce que son client aurait envoyé (charges utiles déjà
 * validées par `parse.ts`), avec les mêmes garanties d'idempotence et les mêmes traitements
 * dérivés (regroupement de donjon, `fight_type`). Les handlers ne gardent que l'authentification,
 * la lecture/validation du corps et la réponse HTTP — aucune logique d'écriture ne doit revenir
 * chez eux, sinon le rejeu et le live divergent.
 *
 * Chaque fonction reçoit un lot DÉJÀ validé (`parseXxxBody`) et non vide, et renvoie la forme
 * exacte de la réponse HTTP (`accepted`/`inserted`), que les handlers renvoient telle quelle.
 */
export interface IngestResult {
  accepted: string[];
  inserted: number;
}

/**
 * Combats (lot 8, prompt 8.1).
 *
 * ## Pourquoi trois requêtes SQL et non deux
 *
 * Le driver `neon-http` n'offre pas de transaction interactive (voir server/db/client.ts) : le
 * combat et ses participants ne peuvent pas être écrits « tout ou rien ». La séquence naïve —
 * insérer les combats en récupérant les `id` des seules lignes nouvelles (`RETURNING`), puis
 * insérer leurs participants — a un défaut : si la seconde requête échoue, le combat reste en base
 * **sans** ses participants, et un rejeu ne le réparerait jamais (son `clientKey` est désormais en
 * conflit, donc plus rien n'est renvoyé).
 *
 * D'où la séquence retenue :
 *   1. `INSERT ... ON CONFLICT DO NOTHING` sur `fights` ;
 *   2. `SELECT id, client_key` pour **tout** le lot (nouvelles lignes comme lignes déjà connues) ;
 *   3. `INSERT ... ON CONFLICT DO NOTHING` sur `fight_participants`.
 *
 * Une requête de plus, mais un rejeu répare alors n'importe quel état intermédiaire — ce qui est
 * exactement la propriété recherchée par ce lot.
 *
 * Deux traitements supplémentaires suivent l'étape 3, nécessaires APRÈS l'écriture des
 * participants (tous deux en dépendent) et rejoués à CHAQUE envoi (pas seulement à l'insertion) :
 *   - Regroupement de donjon multi-salles en autorité (voir `server/history/dungeon-run.ts`) — en
 *     complément du rattachement déjà envoyé par le client, pour le cas cross-session/cross-client
 *     qu'aucun calcul client seul ne peut voir.
 *   - Calcul de `fights.fight_type` (voir `server/history/fight-type.ts`) pour tout le lot,
 *     nouveaux combats comme combats déjà connus — la classification hors donjon dépend de
 *     `fight_participants.monster_id`, et un `dungeonId` fraîchement résolu par le point précédent
 *     doit voir `fight_type` recalculée dans la foulée plutôt que de rester figée à sa valeur
 *     initiale.
 */
export async function ingestFights(
  db: Db,
  userId: string,
  batch: readonly FightInput[],
): Promise<IngestResult> {
  const insertedRows = await db
    .insert(fights)
    .values(
      batch.map((fight) => ({
        userId,
        clientKey: fight.clientKey,
        fightLogId: fight.fightId,
        startedAt: fight.startedAt,
        durationMs: fight.durationMs,
        won: fight.won,
        turns: fight.turns,
        totalDamage: fight.totalDamage,
        xpGained: fight.xpGained,
        kamasGained: fight.kamasGained,
        gameServer: fight.gameServer,
        dungeonId: fight.dungeonId,
        dungeonRunKey: fight.dungeonRunKey,
        challengesPassed: fight.challengesPassed,
        challengesFailed: fight.challengesFailed,
      })),
    )
    // Le cœur de l'idempotence : rejouer le même log ne réécrit rien. Seule
    // exception, `dungeonId`/`dungeonRunKey` : le combat de boss qui révèle le
    // donjon d'un run arrive toujours APRÈS ses salles dans le log, donc une
    // salle synchronisée avant lui n'a encore aucune valeur à envoyer — le
    // client la renvoie une fois le run identifié (voir HistorySyncService),
    // et c'est cette mise à jour ciblée que `onConflictDoUpdate` capture. Le
    // reste de la ligne (dégâts, tours, xp...) reste immuable : une mise à
    // jour plus large rouvrirait la porte aux écrasements par une
    // reconstruction partielle (fichier de log tronqué, rotation...).
    // `COALESCE` protège aussi ces deux colonnes d'un écrasement par un envoi
    // qui n'aurait — faute d'historique complet en mémoire côté client à ce
    // moment-là (voir sa doc) — pas su recalculer le rattachement : `null` ne
    // remplace jamais une valeur déjà connue.
    .onConflictDoUpdate({
      target: [fights.userId, fights.clientKey],
      set: {
        dungeonId: sql`coalesce(excluded.dungeon_id, ${fights.dungeonId})`,
        dungeonRunKey: sql`coalesce(excluded.dungeon_run_key, ${fights.dungeonRunKey})`,
      },
    })
    // `xmax = 0` : idiome Postgres distinguant une ligne réellement insérée
    // (nouvelle) d'une ligne existante seulement touchée par l'`onConflictDoUpdate`
    // ci-dessus — sans ça, `inserted` compterait à tort tout combat déjà connu
    // renvoyé uniquement pour son rattachement de donjon.
    .returning({ clientKey: fights.clientKey, isNew: sql<boolean>`(xmax = 0)` });
  const inserted = insertedRows.filter((row) => row.isNew);

  const keys = batch.map((fight) => fight.clientKey);
  const stored = await db
    .select({ id: fights.id, clientKey: fights.clientKey })
    .from(fights)
    .where(and(eq(fights.userId, userId), inArray(fights.clientKey, keys)));
  const idByKey = new Map(stored.map((row) => [row.clientKey, row.id]));

  const participantRows = batch.flatMap((fight) => {
    const fightId = idByKey.get(fight.clientKey);
    if (fightId === undefined) return [];
    return fight.participants.map((participant) => ({
      fightId,
      side: participant.side,
      name: participant.name,
      monsterId: participant.monsterId,
      instanceIndex: participant.instanceIndex,
      className: participant.className,
      damage: participant.damage,
      defeated: participant.defeated,
      fled: participant.fled,
      spells: participant.spells,
      heal: participant.heal,
      armor: participant.armor,
      healSpells: participant.healSpells,
      armorSpells: participant.armorSpells,
      xpGained: participant.xpGained,
    }));
  });

  if (participantRows.length > 0) {
    await db
      .insert(fightParticipants)
      .values(participantRows)
      // Seule table de l'historique écrite en `DO UPDATE` : une réattribution
      // manuelle de dégâts (`reassignSpell` côté client) renvoie le combat avec
      // sa ventilation corrigée, et c'est cette correction-là qui doit prendre.
      // Le combat parent, lui, reste immuable (`DO NOTHING` plus haut).
      .onConflictDoUpdate({
        target: [
          fightParticipants.fightId,
          fightParticipants.side,
          fightParticipants.name,
          fightParticipants.instanceIndex,
        ],
        set: {
          monsterId: sql`excluded.monster_id`,
          className: sql`excluded.class_name`,
          damage: sql`excluded.damage`,
          defeated: sql`excluded.defeated`,
          fled: sql`excluded.fled`,
          spells: sql`excluded.spells`,
          heal: sql`excluded.heal`,
          armor: sql`excluded.armor`,
          healSpells: sql`excluded.heal_spells`,
          armorSpells: sql`excluded.armor_spells`,
          xpGained: sql`excluded.xp_gained`,
        },
      });
  }

  const touchedFightIds = [...idByKey.values()];

  // Regroupement de donjon multi-salles en autorité (voir server/history/dungeon-run.ts) — AVANT
  // le recalcul de `fight_type` juste en dessous, pour qu'un `dungeonId` fraîchement résolu ici
  // alimente `fight_type` dans la même requête plutôt que d'attendre le prochain envoi. Complète
  // (jamais ne remplace) le rattachement déjà envoyé par le client (COALESCE ci-dessus) : couvre
  // le cas qu'aucun calcul client (web ou overlay, borné à sa session locale) ne peut voir seul.
  if (touchedFightIds.length > 0) {
    const enemyNamesByFightId = new Map<number, string[]>();
    for (const row of participantRows) {
      if (row.side !== 'enemy') continue;
      const list = enemyNamesByFightId.get(row.fightId) ?? [];
      list.push(row.name);
      enemyNamesByFightId.set(row.fightId, list);
    }
    // État RÉEL en base après l'upsert ci-dessus (pas ce que CE lot a envoyé) : une salle déjà
    // connue peut avoir un `dungeonId` posé par un envoi précédent (COALESCE), ou par un autre
    // client — jamais recalculer à partir du seul payload de ce lot.
    const touchedFightRows = await db
      .select({
        id: fights.id,
        startedAt: fights.startedAt,
        won: fights.won,
        dungeonId: fights.dungeonId,
        dungeonRunKey: fights.dungeonRunKey,
      })
      .from(fights)
      .where(inArray(fights.id, touchedFightIds));

    const catalog = await loadCatalogFromDb(db);
    const attachedFightIds = await recomputeDungeonRunsForBatch(
      db,
      userId,
      catalog,
      touchedFightRows.map((row) => ({
        ...row,
        enemyNames: enemyNamesByFightId.get(row.id) ?? [],
      })),
    );
    // Une salle d'un POST antérieur rattachée seulement maintenant (fenêtre de lookback) doit voir
    // son `fight_type` recalculé avec le lot — voir la doc de `recomputeDungeonRunsForBatch`.
    for (const id of attachedFightIds) {
      if (!touchedFightIds.includes(id)) touchedFightIds.push(id);
    }
  }

  // Classification matérialisée du combat (`fight_type`, voir server/history/fight-type.ts) —
  // recalculée pour TOUT le lot (combats nouveaux comme déjà connus) : un combat déjà connu peut
  // être renvoyé uniquement pour son rattachement de donjon a posteriori (voir la doc de
  // `dungeonId` ci-dessus), auquel cas `fight_type` doit être recalculée avec lui dans la même
  // requête plutôt que de rester figée à sa valeur `FAMILY_*`/`EVENT`/`null` initiale. Nécessite les
  // participants déjà écrits (requête précédente) : la classification "hors donjon" dépend de
  // `fight_participants.monster_id`.
  if (touchedFightIds.length > 0) {
    const scope = sql`f.id in (${sql.join(
      touchedFightIds.map((id) => sql`${id}`),
      sql`, `,
    )})`;
    await db.execute(dungeonFightTypeUpdateSql(scope));
    await db.execute(familyFightTypeUpdateSql(scope));
    await db.execute(eventFightTypeUpdateSql(scope));
  }

  const lootRows = batch.flatMap((fight) => {
    const fightId = idByKey.get(fight.clientKey);
    if (fightId === undefined) return [];
    return fight.loot.map((row) => ({
      fightId,
      lineIndex: row.lineIndex,
      itemId: row.itemId,
      itemName: row.itemName,
      quantity: row.quantity,
    }));
  });

  if (lootRows.length > 0) {
    // Le CONTENU du butin d'un combat terminé ne bouge plus, mais son IDENTIFICATION, si (correction
    // manuelle d'objet homonyme, voir ItemPickerService côté client) : `DO UPDATE` sur `item_id`/
    // `item_name` plutôt que `DO NOTHING`, une relecture du même log réécrivant de toute façon les
    // mêmes valeurs en l'absence de correction.
    await db
      .insert(fightLoot)
      .values(lootRows)
      .onConflictDoUpdate({
        target: [fightLoot.fightId, fightLoot.lineIndex],
        set: { itemId: sql`excluded.item_id`, itemName: sql`excluded.item_name` },
      });
  }

  return {
    // Toutes les clés du lot sont « acceptées » : celles déjà connues du compte
    // le sont tout autant que les nouvelles, et c'est ce que la file cliente
    // attend pour retirer l'entrée de sa file — un doublon n'est pas un échec.
    accepted: keys,
    inserted: inserted.length,
  };
}

/**
 * Achats (lot 8, prompt 8.1). Une seule table, donc pas de séquence en trois temps comme pour les
 * combats : un `INSERT ... ON CONFLICT` suffit à rendre l'ingestion idempotente.
 *
 * `gameServer` vient de `GameServerService` côté client (lot 7) — et reste vide quand aucun serveur
 * n'a pu être déduit : l'achat part quand même (prompt 8.1 point 4). Aucun rapport avec le
 * monitoring de prix (lot 4), dont la source est un scan de l'hôtel des ventes, jamais les achats
 * des joueurs.
 */
export async function ingestPurchases(
  db: Db,
  userId: string,
  batch: readonly PurchaseInput[],
): Promise<IngestResult> {
  const inserted = await db
    .insert(purchases)
    .values(
      batch.map((purchase) => ({
        userId,
        clientKey: purchase.clientKey,
        itemId: purchase.itemId,
        itemName: purchase.itemName,
        quantity: purchase.quantity,
        totalCost: purchase.totalCost,
        occurredAt: purchase.occurredAt,
        gameServer: purchase.gameServer,
      })),
    )
    // `DO UPDATE` plutôt que `DO NOTHING` : un achat déjà connu peut revenir avec une identification
    // d'objet corrigée (voir ItemPickerService côté client, homonymes de rareté différente) — le
    // reste de l'achat, lui, ne bouge jamais après coup (mêmes valeurs de toute façon en l'absence
    // de correction). `inserted.length` compte donc désormais les lignes insérées OU mises à jour,
    // pas seulement les nouvelles (champ purement informatif, non consommé côté client).
    .onConflictDoUpdate({
      target: [purchases.userId, purchases.clientKey],
      set: { itemId: sql`excluded.item_id`, itemName: sql`excluded.item_name` },
    })
    .returning({ clientKey: purchases.clientKey });

  return {
    accepted: batch.map((purchase) => purchase.clientKey),
    inserted: inserted.length,
  };
}

/** Échanges entre joueurs — même séquence en trois temps que les combats (voir `ingestFights`). */
export async function ingestTrades(
  db: Db,
  userId: string,
  batch: readonly TradeInput[],
): Promise<IngestResult> {
  const inserted = await db
    .insert(trades)
    .values(
      batch.map((trade) => ({
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

  const keys = batch.map((trade) => trade.clientKey);
  const stored = await db
    .select({ id: trades.id, clientKey: trades.clientKey })
    .from(trades)
    .where(and(eq(trades.userId, userId), inArray(trades.clientKey, keys)));
  const idByKey = new Map(stored.map((row) => [row.clientKey, row.id]));

  const itemRows = batch.flatMap((trade) => {
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
    // `DO UPDATE` plutôt que `DO NOTHING` — voir `ingestPurchases` (même raison : correction
    // manuelle d'objet homonyme, voir ItemPickerService côté client).
    await db
      .insert(tradeItems)
      .values(itemRows)
      .onConflictDoUpdate({
        target: [tradeItems.tradeId, tradeItems.direction, tradeItems.lineIndex],
        set: { itemId: sql`excluded.item_id`, itemName: sql`excluded.item_name` },
      });
  }

  return { accepted: keys, inserted: inserted.length };
}

/** Extractions de pacte — même séquence en trois temps que les échanges. */
export async function ingestPactExtractions(
  db: Db,
  userId: string,
  batch: readonly PactExtractionInput[],
): Promise<IngestResult> {
  const inserted = await db
    .insert(pactExtractions)
    .values(
      batch.map((pact) => ({
        userId,
        clientKey: pact.clientKey,
        occurredAt: pact.occurredAt,
        gameServer: pact.gameServer,
      })),
    )
    .onConflictDoNothing({ target: [pactExtractions.userId, pactExtractions.clientKey] })
    .returning({ clientKey: pactExtractions.clientKey });

  const keys = batch.map((pact) => pact.clientKey);
  const stored = await db
    .select({ id: pactExtractions.id, clientKey: pactExtractions.clientKey })
    .from(pactExtractions)
    .where(and(eq(pactExtractions.userId, userId), inArray(pactExtractions.clientKey, keys)));
  const idByKey = new Map(stored.map((row) => [row.clientKey, row.id]));

  const itemRows = batch.flatMap((pact) => {
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
    // `DO UPDATE` plutôt que `DO NOTHING` — voir `ingestPurchases` (même raison : correction
    // manuelle d'objet homonyme, voir PactReassignService côté client).
    await db
      .insert(pactExtractionItems)
      .values(itemRows)
      .onConflictDoUpdate({
        target: [pactExtractionItems.extractionId, pactExtractionItems.lineIndex],
        set: { itemId: sql`excluded.item_id`, itemName: sql`excluded.item_name` },
      });
  }

  return { accepted: keys, inserted: inserted.length };
}
