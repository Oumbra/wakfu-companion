#!/usr/bin/env -S npx tsx
/**
 * Rattrapage ponctuel : corrige les combats rattachés À TORT à une brèche ultime
 * (`fights.dungeon_id` pointant sur un donjon `type = 'ULTIMATE_BREACH'`) alors qu'ils ne
 * contiennent qu'UN SEUL boss — bug corrigé le 2026-09-13, voir
 * `src/app/core/utils/dungeon-boss-index.util.ts` (index « boss → donjon » qui laissait gagner la
 * brèche ultime sur le donjon classique selon l'ordre des lignes de `dungeons`). Constat au moment
 * du correctif : 57 combats en prod (43 « Flaque Royale »/Donjon Flaqueux, le reste sur 8 autres
 * boss des brèches de Frigost, du Mont Zinit et de la Shukrute), 1 en dev.
 *
 * Aucun des mécanismes existants ne pouvait rattraper ces lignes seul : `applyDungeonRunUpdates`
 * (live comme script `backfill-dungeon-runs.ts`) n'écrit que `WHERE dungeon_id IS NULL`, et le
 * `POST /api/v1/history/fights` ne remplace jamais un `dungeon_id` déjà posé (`COALESCE`) — une
 * valeur fausse était donc gelée pour toujours, tout comme les salles précédant ces boss, restées
 * `dungeon_id NULL` faute de regroupement (une brèche ultime n'a qu'une « salle »).
 *
 * Trois étapes, dans l'ordre, pour chaque compte touché :
 *   1. Re-résolution du donjon de chaque combat actuellement rattaché à une brèche ultime, avec le
 *      résolveur CORRIGÉ (`findDungeonForEnemyNames`, catalogue lu en base comme le POST live) :
 *      un combat qui résout maintenant un donjon DIFFÉRENT reçoit ce nouveau `dungeon_id`. Son
 *      `dungeon_run_key` est conservé tel quel (c'est la clé propre du combat de boss, indépendante
 *      du donjon — voir `HistorySyncService`/`resolveDungeonAssignment`). Un combat qui résout
 *      toujours la MÊME brèche ultime (plusieurs boss distincts, cas légitime) est laissé intact.
 *   2. Regroupement des salles : rejoue `resolveUpdatesForUser` (même algorithme que le script de
 *      rattrapage et le POST live) sur tout l'historique du compte, pour rattacher les salles
 *      encore `NULL` qui précèdent les boss corrigés (elles héritent du `dungeon_run_key` du boss).
 *   3. Recalcul de `fight_type` pour tous les combats touchés (étapes 1 et 2) — `ULTIMATE_BREACH`
 *      → `DUNGEON_TWO_ROOMS`/..., `FAMILY_*` → `DUNGEON_ROOM` pour les salles.
 *
 * Idempotent : un rejeu après application ne trouve plus aucun combat à corriger (étape 1 vide),
 * les étapes 2 et 3 ne réécrivant que des lignes encore `NULL`/déjà cohérentes. Dry-run par défaut
 * — `--apply` pour écrire réellement.
 *
 * Usage :
 *   node tools/with-dev-vars.mjs node node_modules/tsx/dist/cli.mjs server/import/fix-breach-dungeon-ids.ts [--apply] [--user=<uuid>]
 *   node tools/with-vars.mjs     node node_modules/tsx/dist/cli.mjs server/import/fix-breach-dungeon-ids.ts [--apply] [--user=<uuid>]
 *
 * (`node node_modules/tsx/dist/cli.mjs` plutôt que `npx tsx` sous Windows — voir la doc de
 * `backfill-dungeon-runs.ts`.)
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { createDb, type Db } from '../db/client';
import { fightParticipants, fights } from '../db/schema';
import {
  applyDungeonRunUpdates,
  enemyCompositionKey,
  findDungeonForEnemyNames,
  hasArchiEnemy,
  loadCatalogFromDb,
  resolveUpdatesForUser,
  type Catalog,
  type FightRow,
} from '../history/dungeon-run';
import {
  dungeonFightTypeUpdateSql,
  eventFightTypeUpdateSql,
  familyFightTypeUpdateSql,
} from '../history/fight-type';

const CHUNK = 500;

async function loadEnemyNames(db: Db, fightIds: readonly number[]): Promise<Map<number, string[]>> {
  const byFightId = new Map<number, string[]>();
  for (let i = 0; i < fightIds.length; i += CHUNK) {
    const idsChunk = fightIds.slice(i, i + CHUNK);
    const rows = await db
      .select({ fightId: fightParticipants.fightId, name: fightParticipants.name })
      .from(fightParticipants)
      .where(
        and(eq(fightParticipants.side, 'enemy'), inArray(fightParticipants.fightId, idsChunk)),
      );
    for (const row of rows) {
      const list = byFightId.get(row.fightId) ?? [];
      list.push(row.name);
      byFightId.set(row.fightId, list);
    }
  }
  return byFightId;
}

/** Étape 2 — même construction de `FightRow[]` que `backfill-dungeon-runs.ts::main`. `overrides`
 * (dry-run uniquement) : réaffectations de l'étape 1 appliquées en mémoire, pour que le
 * regroupement voie déjà les boss corrigés sans rien avoir écrit. */
async function resolveRoomUpdatesForUser(
  db: Db,
  catalog: Catalog,
  userId: string,
  overrides: ReadonlyMap<number, number | null>,
): Promise<ReturnType<typeof resolveUpdatesForUser>> {
  const rows = await db
    .select({
      id: fights.id,
      startedAt: fights.startedAt,
      won: fights.won,
      dungeonId: fights.dungeonId,
      dungeonRunKey: fights.dungeonRunKey,
    })
    .from(fights)
    .where(eq(fights.userId, userId))
    .orderBy(asc(fights.startedAt), asc(fights.id));
  const enemyNamesByFightId = await loadEnemyNames(
    db,
    rows.map((row) => row.id),
  );
  const fightRows: FightRow[] = rows.map((row) => {
    const enemyNames = enemyNamesByFightId.get(row.id) ?? [];
    const dungeonId = overrides.has(row.id) ? overrides.get(row.id)! : row.dungeonId;
    return {
      id: row.id,
      startedAt: row.startedAt,
      result: row.won === true ? 'won' : 'lost',
      dungeonId,
      dungeonRunKey: dungeonId === null ? null : row.dungeonRunKey,
      dungeon: findDungeonForEnemyNames(catalog, enemyNames),
      archi: hasArchiEnemy(catalog, enemyNames),
      roomKey: enemyCompositionKey(enemyNames),
    };
  });
  return resolveUpdatesForUser(fightRows);
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL manquant.');
  const apply = process.argv.includes('--apply');
  const userArg = process.argv.find((arg) => arg.startsWith('--user='));
  const onlyUserId = userArg ? userArg.slice('--user='.length) : null;
  const tag = apply ? 'UPDATE' : '[dry-run]';

  const db = createDb(databaseUrl);
  const catalog = await loadCatalogFromDb(db);
  const ultimateBreachIds = catalog.dungeons
    .filter((dungeon) => dungeon.type === 'ULTIMATE_BREACH')
    .map((dungeon) => dungeon.id);
  const dungeonTypeById = new Map(catalog.dungeons.map((d) => [d.id, d.type]));

  // ---- Étape 1 : re-résolution des combats actuellement rattachés à une brèche ultime.
  const suspects = await db
    .select({
      id: fights.id,
      userId: fights.userId,
      startedAt: fights.startedAt,
      dungeonId: fights.dungeonId,
      dungeonRunKey: fights.dungeonRunKey,
    })
    .from(fights)
    .where(
      and(
        inArray(fights.dungeonId, ultimateBreachIds),
        onlyUserId ? eq(fights.userId, onlyUserId) : sql`true`,
      ),
    )
    .orderBy(asc(fights.startedAt));
  console.log(
    `[fix-breach-dungeon-ids] ${suspects.length} combat(s) rattaché(s) à une brèche ultime à réexaminer.`,
  );

  const enemyNamesByFightId = await loadEnemyNames(
    db,
    suspects.map((row) => row.id),
  );
  const reassignments: { id: number; userId: string; from: number; to: number | null }[] = [];
  for (const row of suspects) {
    const resolved = findDungeonForEnemyNames(catalog, enemyNamesByFightId.get(row.id) ?? []);
    const to = resolved?.id ?? null;
    if (to === row.dungeonId) continue;
    reassignments.push({ id: row.id, userId: row.userId, from: row.dungeonId!, to });
    console.log(
      `  ${tag} fight #${row.id} (${row.startedAt.toISOString()}) dungeon_id ${row.dungeonId} (${dungeonTypeById.get(row.dungeonId!)}) -> ${to ?? 'NULL'}${to !== null ? ` (${dungeonTypeById.get(to)})` : ''}`,
    );
  }
  console.log(
    `[fix-breach-dungeon-ids] Étape 1 : ${reassignments.length} combat(s) à corriger, ${suspects.length - reassignments.length} légitime(s) (plusieurs boss) laissé(s) intact(s).`,
  );

  const touchedFightIds = new Set<number>(reassignments.map((r) => r.id));
  const touchedUserIds = [...new Set(reassignments.map((r) => r.userId))];

  if (apply) {
    for (const r of reassignments) {
      // `dungeon_run_key` : conservé pour un rattachement à un autre donjon (clé propre du combat
      // de boss, indépendante du donjon) ; effacé seulement si plus aucun donjon ne s'applique.
      if (r.to === null) {
        await db
          .update(fights)
          .set({ dungeonId: null, dungeonRunKey: null })
          .where(and(eq(fights.id, r.id), eq(fights.dungeonId, r.from)));
      } else {
        await db
          .update(fights)
          .set({ dungeonId: r.to })
          .where(and(eq(fights.id, r.id), eq(fights.dungeonId, r.from)));
      }
    }
  }

  // ---- Étape 2 : regroupement des salles des comptes touchés (héritent de la clé du boss).
  let roomsAttached = 0;
  for (const userId of touchedUserIds) {
    // En dry-run, l'étape 1 n'a rien écrit : simuler son effet en mémoire pour que le regroupement
    // voie déjà les boss corrigés (sinon `groupDungeonRuns` les traite encore comme des brèches).
    const overrides = new Map(
      apply ? [] : reassignments.map((r): [number, number | null] => [r.id, r.to]),
    );
    const updates = await resolveRoomUpdatesForUser(db, catalog, userId, overrides);
    if (updates.size === 0) continue;
    roomsAttached += updates.size;
    for (const [fightId, update] of updates) {
      touchedFightIds.add(fightId);
      console.log(
        `  ${tag} salle fight #${fightId} -> dungeon_id=${update.dungeonId}, dungeon_run_key=${update.dungeonRunKey}`,
      );
    }
    if (apply) await applyDungeonRunUpdates(db, userId, updates);
  }
  console.log(`[fix-breach-dungeon-ids] Étape 2 : ${roomsAttached} salle(s) à rattacher.`);

  // ---- Étape 3 : `fight_type` des combats touchés.
  if (touchedFightIds.size > 0 && apply) {
    const ids = [...touchedFightIds];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const scope = sql`f.id in (${sql.join(
        ids.slice(i, i + CHUNK).map((id) => sql`${id}`),
        sql`, `,
      )})`;
      await db.execute(dungeonFightTypeUpdateSql(scope));
      await db.execute(familyFightTypeUpdateSql(scope));
      await db.execute(eventFightTypeUpdateSql(scope));
    }
  }
  console.log(
    `[fix-breach-dungeon-ids] Étape 3 : fight_type ${apply ? 'recalculé' : 'à recalculer'} pour ${touchedFightIds.size} combat(s).`,
  );
  if (!apply) {
    console.log('[fix-breach-dungeon-ids] Dry-run — relancer avec --apply pour écrire réellement.');
  } else {
    console.log('[fix-breach-dungeon-ids] Terminé.');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
