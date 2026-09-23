#!/usr/bin/env -S npx tsx
/**
 * Nettoyage ponctuel : combats DUPLIQUÉS par l'ancien bug client de renvoi depuis l'archive
 * (2026-09-23). Une correction faite sur un combat rechargé depuis l'archive du compte partait avec
 * une signature portant l'`id` d'affichage NÉGATIF du combat archivé — donc une `clientKey` neuve —
 * et sans `fightId` du log : le serveur créait un nouveau combat (`fight_log_id` NULL) au lieu de
 * mettre à jour l'original. Le client renvoie désormais sous la `clientKey` d'origine ; ce script
 * efface les doublons déjà en base.
 *
 * ## Critères (voir `planFightDedup`, server/history/dedupe-fights.ts)
 *
 * Mêmes `user_id`, `started_at`, `duration_ms` et ensemble de participants (nom#instance), au moins
 * un membre à `fight_log_id` NULL. Sont effacés UNIQUEMENT les membres à `fight_log_id` NULL ; le
 * combat conservé est l'original (qui porte un `fight_log_id`), à défaut le plus ancien.
 *
 * ## Report de la dernière correction
 *
 * Avant l'effacement, les participants du doublon le plus RÉCENT (celui qui porte la dernière
 * correction envoyée par l'utilisateur : réattribution de sort, camp, dégâts...) sont recopiés sur
 * ceux du combat conservé, siège par siège (nom, instance) — sinon effacer le doublon ferait perdre
 * la correction que l'utilisateur voulait appliquer. `--no-transfer` désactive ce report. Le butin
 * n'est PAS reporté : ses lignes sont appariées par position (`line_index`), et la position d'une
 * ligne dans un combat reconstruit depuis l'archive n'est pas garantie identique à l'original
 * (butin fusionné à la lecture) — un report risquerait de réécrire l'identité d'une autre ligne.
 * `fight_type` des combats conservés est recalculé ensuite (même SQL que l'ingestion).
 *
 * ## Sécurité
 *
 * Dry-run par défaut (rien n'est écrit : nombre de groupes, de combats à effacer, échantillon) —
 * `--apply` pour écrire. `--user=<uuid>` restreint à un compte (recommandé pour une première
 * vérification supervisée). `--verbose` liste chaque groupe. Idempotent : une fois appliqué, un
 * rejeu ne trouve plus de doublon. Les lignes filles (participants, butin) des combats effacés
 * partent en cascade.
 *
 * Usage : `npm run dev:dedupe:archived-fights -- [--apply] [--user=<uuid>] [--verbose]` (preview,
 * `.dev.vars`) ou `npm run main:dedupe:archived-fights -- ...` (prod, `.vars`).
 */
import { sql, type SQL } from 'drizzle-orm';
import { createDb } from '../db/client';
import {
  dungeonFightTypeUpdateSql,
  eventFightTypeUpdateSql,
  familyFightTypeUpdateSql,
} from '../history/fight-type';
import { planFightDedup, type FightDedupRow } from '../history/dedupe-fights';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Taille des lots d'effacement / de recalcul (un `IN (...)` par lot). */
const CHUNK = 500;

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function idList(ids: readonly number[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL manquant.');
  const apply = process.argv.includes('--apply');
  const verbose = process.argv.includes('--verbose');
  const transfer = !process.argv.includes('--no-transfer');
  const userId = argValue('user');
  if (userId !== null && !UUID_PATTERN.test(userId)) throw new Error(`--user invalide : ${userId}`);

  const db = createDb(databaseUrl);
  const userFilter = userId ? sql`and f.user_id = ${userId}::uuid` : sql``;
  // Candidats : combats qui partagent (compte, début) avec au moins un AUTRE combat à
  // `fight_log_id` NULL (index `fights_user_started_at_idx`). Les sièges sont calculés ici, triés
  // en SQL : deux combats aux mêmes participants ont exactement la même chaîne. Encodage JSON
  // (audit du 2026-09-23, S10) : avec un simple `nom#instance` joint par des virgules, un pseudo
  // contenant `,` ou `#` pouvait faire coïncider les sièges de deux combats différents, et l'un des
  // deux aurait été effacé comme doublon.
  const result = await db.execute(sql`
    select f.id, f.user_id::text as user_id, f.started_at::text as started_at, f.duration_ms,
      f.fight_log_id,
      coalesce((
        select jsonb_agg(jsonb_build_array(fp.name, fp.instance_index)
          order by fp.name, fp.instance_index)::text
        from fight_participants fp where fp.fight_id = f.id
      ), '') as seats
    from fights f
    where exists (
      select 1 from fights n
      where n.user_id = f.user_id and n.started_at = f.started_at
        and n.fight_log_id is null and n.id <> f.id
    ) ${userFilter}
  `);
  const rows: FightDedupRow[] = (result.rows as Record<string, unknown>[]).map((row) => ({
    id: Number(row['id']),
    userId: String(row['user_id']),
    startedAt: String(row['started_at']),
    durationMs: row['duration_ms'] === null ? null : Number(row['duration_ms']),
    fightLogId: row['fight_log_id'] === null ? null : Number(row['fight_log_id']),
    seats: String(row['seats']),
  }));

  const plan = planFightDedup(rows);
  const toDelete = plan.flatMap((group) => group.deleteIds);
  console.log(
    `[dedupe-archived-fights] ${rows.length} combat(s) candidat(s), ${plan.length} groupe(s) de ` +
      `doublons, ${toDelete.length} combat(s) à effacer` +
      (userId ? ` (compte ${userId})` : ' (tous comptes)') +
      (transfer ? ', report de la dernière correction sur les participants.' : ', sans report.'),
  );
  for (const group of verbose ? plan : plan.slice(0, 20)) {
    console.log(
      `  garder #${group.keepId} — effacer ${group.deleteIds.map((id) => `#${id}`).join(', ')}` +
        (transfer ? ` (report depuis #${group.latestDuplicateId})` : ''),
    );
  }
  if (!verbose && plan.length > 20) console.log(`  … ${plan.length - 20} groupe(s) de plus.`);

  if (!apply) {
    console.log('[dedupe-archived-fights] Dry-run — relancer avec --apply pour écrire réellement.');
    return;
  }

  let transferred = 0;
  if (transfer) {
    for (const group of plan) {
      const updated = await db.execute(sql`
        update fight_participants k set
          side = d.side, monster_id = d.monster_id, class_name = d.class_name, damage = d.damage,
          defeated = d.defeated, fled = d.fled, spells = d.spells, heal = d.heal, armor = d.armor,
          heal_spells = d.heal_spells, armor_spells = d.armor_spells, xp_gained = d.xp_gained
        from fight_participants d
        where k.fight_id = ${group.keepId} and d.fight_id = ${group.latestDuplicateId}
          and d.name = k.name and d.instance_index = k.instance_index
      `);
      transferred += updated.rowCount ?? 0;
    }
  }

  let deleted = 0;
  for (let offset = 0; offset < toDelete.length; offset += CHUNK) {
    const chunk = toDelete.slice(offset, offset + CHUNK);
    // Garde-fou redondant avec le plan : jamais un combat issu du log.
    const removed = await db.execute(
      sql`delete from fights where id in (${idList(chunk)}) and fight_log_id is null`,
    );
    deleted += removed.rowCount ?? 0;
  }

  const keepIds = plan.map((group) => group.keepId);
  for (let offset = 0; offset < keepIds.length; offset += CHUNK) {
    const scope = sql`f.id in (${idList(keepIds.slice(offset, offset + CHUNK))})`;
    await db.execute(dungeonFightTypeUpdateSql(scope));
    await db.execute(familyFightTypeUpdateSql(scope));
    await db.execute(eventFightTypeUpdateSql(scope));
  }

  console.log(
    `[dedupe-archived-fights] Terminé — ${deleted} combat(s) effacé(s), ${transferred} ` +
      `participant(s) mis à jour, fight_type recalculé pour ${keepIds.length} combat(s).`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
