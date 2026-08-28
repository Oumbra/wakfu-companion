import type { PagesFunction } from '@cloudflare/workers-types';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { fightLoot, fightParticipants, fights } from '../../../../server/db/schema';
import {
  MAX_HISTORY_BATCH,
  parseFightsBody,
  parsePageQuery,
} from '../../../../server/history/parse';
import { authenticate, json, jsonError, requireCsrf, unauthenticated } from '../../_auth';
import type { Env } from '../../_types';

/**
 * Historique de combats du compte (lot 8, prompt 8.1).
 *
 * - `POST` — ingestion **idempotente** par lots (voir plus bas).
 * - `GET`  — lecture paginée par curseur (`?limit=&before=`), la plus récente
 *   d'abord.
 *
 * ## Pourquoi trois requêtes SQL et non deux
 *
 * Le driver `neon-http` n'offre pas de transaction interactive (voir
 * server/db/client.ts) : le combat et ses participants ne peuvent pas être
 * écrits « tout ou rien ». La séquence naïve — insérer les combats en
 * récupérant les `id` des seules lignes nouvelles (`RETURNING`), puis insérer
 * leurs participants — a un défaut : si la seconde requête échoue, le combat
 * reste en base **sans** ses participants, et un rejeu ne le réparerait jamais
 * (son `clientKey` est désormais en conflit, donc plus rien n'est renvoyé).
 *
 * D'où la séquence retenue :
 *   1. `INSERT ... ON CONFLICT DO NOTHING` sur `fights` ;
 *   2. `SELECT id, client_key` pour **tout** le lot (nouvelles lignes comme
 *      lignes déjà connues) ;
 *   3. `INSERT ... ON CONFLICT DO NOTHING` sur `fight_participants`.
 *
 * Une requête de plus, mais un rejeu répare alors n'importe quel état
 * intermédiaire — ce qui est exactement la propriété recherchée par ce lot.
 */

/** Garde-fou de taille, en miroir de `MAX_HISTORY_BATCH` (un combat porte jusqu'à 64 participants). */
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

  const parsed = parseFightsBody(body);
  if (!parsed.ok) return jsonError(parsed.error, 400);
  if (parsed.value.length === 0) return json({ accepted: [], inserted: 0 });

  const db = createDb(context.env.DATABASE_URL);
  const userId = auth.user.id;

  const insertedRows = await db
    .insert(fights)
    .values(
      parsed.value.map((fight) => ({
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

  const keys = parsed.value.map((fight) => fight.clientKey);
  const stored = await db
    .select({ id: fights.id, clientKey: fights.clientKey })
    .from(fights)
    .where(and(eq(fights.userId, userId), inArray(fights.clientKey, keys)));
  const idByKey = new Map(stored.map((row) => [row.clientKey, row.id]));

  const participantRows = parsed.value.flatMap((fight) => {
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
      spells: participant.spells,
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
          spells: sql`excluded.spells`,
          xpGained: sql`excluded.xp_gained`,
        },
      });
  }

  const lootRows = parsed.value.flatMap((fight) => {
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

  return json({
    // Toutes les clés du lot sont « acceptées » : celles déjà connues du compte
    // le sont tout autant que les nouvelles, et c'est ce que la file cliente
    // attend pour retirer l'entrée de sa file — un doublon n'est pas un échec.
    accepted: keys,
    inserted: inserted.length,
  });
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();

  const query = parsePageQuery(new URL(context.request.url).searchParams);
  if (!query.ok) return jsonError(query.error, 400);

  const db = createDb(context.env.DATABASE_URL);
  const where = query.value.before
    ? and(eq(fights.userId, auth.user.id), lt(fights.startedAt, query.value.before))
    : eq(fights.userId, auth.user.id);

  const rows = await db
    .select()
    .from(fights)
    .where(where)
    .orderBy(desc(fights.startedAt), desc(fights.id))
    .limit(query.value.limit);

  const participants =
    rows.length > 0
      ? await db
          .select()
          .from(fightParticipants)
          .where(
            inArray(
              fightParticipants.fightId,
              rows.map((row) => row.id),
            ),
          )
      : [];

  const loot =
    rows.length > 0
      ? await db
          .select()
          .from(fightLoot)
          .where(
            inArray(
              fightLoot.fightId,
              rows.map((row) => row.id),
            ),
          )
      : [];

  const participantsByFight = new Map<number, typeof participants>();
  for (const participant of participants) {
    const list = participantsByFight.get(participant.fightId) ?? [];
    list.push(participant);
    participantsByFight.set(participant.fightId, list);
  }

  const lootByFight = new Map<number, typeof loot>();
  for (const row of loot) {
    const list = lootByFight.get(row.fightId) ?? [];
    list.push(row);
    lootByFight.set(row.fightId, list);
  }

  return json({
    entries: rows.map((row) => ({
      clientKey: row.clientKey,
      startedAt: row.startedAt.toISOString(),
      durationMs: row.durationMs,
      won: row.won,
      turns: row.turns,
      totalDamage: row.totalDamage,
      xpGained: row.xpGained,
      kamasGained: row.kamasGained,
      gameServer: row.gameServer,
      dungeonId: row.dungeonId,
      dungeonRunKey: row.dungeonRunKey,
      challengesPassed: row.challengesPassed,
      challengesFailed: row.challengesFailed,
      participants: (participantsByFight.get(row.id) ?? []).map((participant) => ({
        side: participant.side,
        name: participant.name,
        monsterId: participant.monsterId,
        instanceIndex: participant.instanceIndex,
        className: participant.className,
        damage: participant.damage,
        defeated: participant.defeated,
        spells: participant.spells,
        xpGained: participant.xpGained,
      })),
      loot: (lootByFight.get(row.id) ?? []).map((line) => ({
        itemId: line.itemId,
        itemName: line.itemName,
        quantity: line.quantity,
      })),
    })),
    // Curseur de la page suivante : `null` quand la page n'est pas pleine, donc
    // qu'il n'y a plus rien derrière.
    nextBefore:
      rows.length === query.value.limit ? rows[rows.length - 1].startedAt.toISOString() : null,
    maxBatch: MAX_HISTORY_BATCH,
  });
};
