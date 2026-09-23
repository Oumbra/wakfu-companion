import type { PagesFunction } from '@cloudflare/workers-types';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { fightLoot, fightParticipants, fights } from '../../../../server/db/schema';
import { ingestFights } from '../../../../server/history/ingest';
import {
  MAX_HISTORY_BATCH,
  parseFightsBody,
  parsePageQuery,
} from '../../../../server/history/parse';
import {
  HISTORY_QUOTA_EXCEEDED_CODE,
  MAX_FIGHTS_PER_ACCOUNT,
  checkFightQuota,
  checkHistoryReferences,
} from '../../../../server/history/guards';
import { readJsonBodyLimited } from '../../../../server/http/body';
import { enforceUserRateLimit, internalErrorResponse } from '../../../../server/http/api-guards';
import { authenticate, json, jsonError, requireCsrf, unauthenticated } from '../../_auth';
import type { Env } from '../../_types';

/**
 * Historique de combats du compte (lot 8, prompt 8.1).
 *
 * - `POST` — ingestion **idempotente** par lots : tout le travail d'écriture (séquence en trois
 *   temps sans transaction, regroupement de donjon, `fight_type`) vit dans
 *   `server/history/ingest.ts::ingestFights`, partagé avec le script de rejeu de support — ce
 *   handler ne fait que l'authentification, la validation du corps et la réponse HTTP.
 * - `GET`  — lecture paginée par curseur (`?limit=&before=`), la plus récente
 *   d'abord.
 */

/** Garde-fou de taille, en miroir de `MAX_HISTORY_BATCH` (un combat porte jusqu'à 128 participants),
 * mesuré en OCTETS et appliqué pendant la lecture (`readJsonBodyLimited`, server/http/body.ts). */
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

    const parsed = parseFightsBody(body.value);
    if (!parsed.ok) return jsonError(parsed.error, 400);
    if (parsed.value.length === 0) return json({ accepted: [], inserted: 0 });

    const db = createDb(context.env.DATABASE_URL);
    // Références inconnues ⇒ 400 plutôt qu'une violation de clé étrangère en 500 (guards.ts).
    const unknownReference = await checkHistoryReferences(db, parsed.value);
    if (unknownReference) return jsonError(unknownReference, 400);
    if (
      !(await checkFightQuota(
        db,
        auth.user.id,
        parsed.value.map((f) => f.clientKey),
      ))
    ) {
      return json(
        {
          error: `quota de combats atteint (${MAX_FIGHTS_PER_ACCOUNT} par compte)`,
          code: HISTORY_QUOTA_EXCEEDED_CODE,
        },
        403,
      );
    }
    return json(await ingestFights(db, auth.user.id, parsed.value));
  } catch (error) {
    // Jamais le message Postgres au client : journalisé côté serveur, 500 générique.
    return internalErrorResponse('history/fights POST', error);
  }
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
      fightType: row.fightType,
      participants: (participantsByFight.get(row.id) ?? []).map((participant) => ({
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
