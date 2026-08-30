#!/usr/bin/env -S npx tsx
/**
 * Rattrapage ponctuel : résout `fights.dungeon_id`/`fights.dungeon_run_key` pour les combats déjà
 * archivés en base qui n'ont jamais reçu ce rattachement (`dungeon_id IS NULL`).
 *
 * ## Pourquoi ces combats existent en base sans rattachement
 *
 * `dungeonId`/`dungeonRunKey` sont résolus **côté client** au moment de l'envoi
 * (`HistorySyncService.resolveDungeonAssignment`, voir src/app/core/sync/history-sync.service.ts) à
 * partir de l'historique de session connu à cet instant (`historyList`) : une salle de donjon
 * envoyée avant que son boss n'apparaisse dans cet historique repart sans rattachement, et n'est
 * réenvoyée avec la bonne valeur QUE si le combat de boss du même run est lui-même (re)traité dans
 * la MÊME session live (voir `recordFight`, qui propage alors aux `siblings`). Deux cas concrets
 * laissent des lignes orphelines en base, sans qu'aucun résync client ne puisse jamais les
 * rattraper :
 *   1. Combats synchronisés **avant** l'introduction de ce champ (2026-08-26) — le payload envoyé à
 *      l'époque ne portait ni `dungeonId` ni `dungeonRunSignature` du tout.
 *   2. Une salle synchronisée dont le combat de boss n'a plus jamais été rejoué dans le même
 *      `wakfu.log` (rotation/purge du fichier, ou simplement fin de la session avant le boss) : le
 *      client n'a alors plus aucune occasion de renvoyer cette salle avec son rattachement.
 *
 * Ce script rejoue donc **côté serveur**, à partir de ce qui est déjà en base
 * (`fights.started_at`/`fights.won` + `fight_participants` côté ennemi), le même algorithme que le
 * client :
 *   - détection du donjon d'un combat par ses ennemis — miroir de `findDungeonForEnemies`
 *     (core/utils/fight-image.util.ts) ;
 *   - regroupement salles + boss d'un même run — miroir de `groupDungeonRuns`
 *     (core/utils/dungeon-run-grouping.util.ts).
 *
 * Ports plutôt qu'imports directs de ces deux fichiers (délibéré, même choix que
 * `backfill-monster-ids.ts` pour `CatalogService.applyIndex`) : les deux dépendent de types de
 * `core/api/catalog.service.ts`, un fichier qui importe `@angular/core`/`ApiClientService`/
 * `PersistenceService` — les faire transiter par `tsx` (transpilation fichier par fichier, sans
 * vérification de types inter-fichiers) risquerait de tirer ce module Angular dans un script Node
 * pur pour un gain nul (la logique elle-même est déjà petite et pure). La lecture du référentiel se
 * fait directement depuis `repository/*.json` (même source que `import-catalog.ts`, donc que les
 * tables `monsters`/`dungeons` déjà en base), pas via une requête sur ces tables : plus simple, et
 * même schéma de confiance que `backfill-monster-ids.ts`.
 *
 * ## Pas de découpage par écart de temps (retiré le 2026-08-30)
 *
 * Une première version de ce script découpait l'historique en segments dès qu'un écart de plus de
 * 5 min séparait deux combats consécutifs, avant d'appeler `groupDungeonRuns` sur chaque segment
 * indépendamment — garde-fou contre le risque de fusionner à tort la fin d'une session avec le
 * début de la suivante. Retiré (remonté par l'utilisateur sur un cas réel) : ce seuil, recyclé
 * depuis un tout autre usage (`StatsStoreService.accumulateSessionDuration`, calibré pour décider
 * si un écart signale une COUPURE de connexion), cassait la fusion de tentatives de boss/salle
 * pourtant légitimement espacées de plus de 5 min (pause en plein donjon, coupure réseau, temps de
 * discussion de groupe...) — observé jusqu'à ~20 min entre deux tentatives d'un même run réel.
 *
 * Remplacé par une protection basée sur le CONTENU plutôt que le temps (voir `groupDungeonRuns`,
 * étape 3, `roomCompositionKey`) : une défaite n'est ramassée comme tentative ratée d'une salle que
 * si sa composition d'ennemis correspond EXACTEMENT à celle de la victoire qui la referme — un
 * combat réellement sans rapport (composition différente) n'est donc plus jamais avalé, quel que
 * soit l'écart de temps qui le sépare de cette victoire. Le cluster de tentatives de boss (étape 1)
 * n'avait de toute façon jamais eu besoin d'un tel seuil : il est déjà gardé par l'identité du
 * donjon (`candidate.id === dungeon.id`), un contenu, pas un temps.
 *
 * ## Valeur de `dungeon_run_key` attribuée
 *
 * - Si un des combats du run porte déjà un `dungeon_run_key` (cas normal : le combat de boss a son
 *   propre rattachement dès son envoi initial, voir `resolveDungeonAssignment`, MÊME si ses salles
 *   ne l'ont jamais reçu) : cette valeur existante est réutilisée telle quelle pour les combats
 *   encore `NULL` du même run — jamais recalculée, pour rester bit-à-bit identique à ce qu'un futur
 *   résync client produirait (même valeur `sha256(uid|'fight'|signature)`, voir client-key.util.ts).
 * - Sinon (aucun combat du run n'a jamais reçu de clé — cas 1 ci-dessus, combats antérieurs à la
 *   fonctionnalité) : impossible à reconstruire à l'identique depuis la seule base (la signature
 *   client dépend de l'heure BRUTE du log, `HH:MM:SS,mmm`, non conservée telle quelle — seul
 *   `started_at`, un instant absolu, est stocké). Une clé synthétique `migrated:<id du combat
 *   représentatif>` est utilisée à la place : déterministe, unique (basée sur `fights.id`, la clé
 *   primaire), et volontairement dans un format qui ne peut JAMAIS collisionner avec une vraie clé
 *   client (hex sha256, 64 caractères) si ce même run était un jour réidentifié par le client.
 *
 * ## Sécurité / idempotence
 *
 * Seules les lignes encore `dungeon_id IS NULL` sont écrites (`WHERE ... AND dungeon_id IS NULL`
 * dans l'UPDATE, en plus du filtre déjà appliqué en lecture) — jamais un combat déjà rattaché,
 * exactement la même garde que `onConflictDoUpdate`/`COALESCE` côté
 * `functions/api/v1/history/fights.ts`. Un rejeu de ce script après application ne trouve donc plus
 * rien à faire. Dry-run par défaut (rien n'est écrit) — `--apply` pour écrire réellement.
 *
 * Usage :
 *   DATABASE_URL=... npx tsx server/import/backfill-dungeon-runs.ts [--apply] [--user=<uuid>] [--verbose]
 *   # ou, pour charger DATABASE_URL depuis .vars/.dev.vars (voir tools/with-vars.mjs) :
 *   node tools/with-vars.mjs node node_modules/tsx/dist/cli.mjs server/import/backfill-dungeon-runs.ts [--apply] [--user=<uuid>] [--verbose]
 *
 *   --user=<uuid>  Ne traite qu'un seul compte (recommandé pour une première vérification
 *                  supervisée avant un passage sur toute la base).
 *   --verbose      Détaille chaque combat mis à jour (par défaut, un échantillon de 20 par compte).
 *
 * ⚠️ Sous Windows, préférer `node node_modules/tsx/dist/cli.mjs <script>` à `npx tsx <script>` quand
 * la commande passe par `tools/with-vars.mjs` (`spawnSync(..., { shell: true })`, qui concatène
 * command+args en une seule ligne cmd.exe SANS les re-quoter) : `npx` ajoute un niveau de résolution
 * de plus (shim `.cmd`) qui s'est avéré source d'échecs silencieux (aucune sortie, code de sortie 0,
 * comme si rien ne s'était exécuté) sur au moins une machine Windows réelle — jamais reproduit tel
 * quel, mais l'invocation `node node_modules/tsx/dist/cli.mjs` (un seul exécutable, pas de shim) l'a
 * contourné à coup sûr. Argument sans espace uniquement dans tous les cas (même limitation de
 * `with-vars.mjs` : un argument contenant un espace serait tronqué par cmd.exe, voir sa doc).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createDb } from '../db/client';
import { fightParticipants, fights } from '../db/schema';
import { normalizeWakfuName } from '../../src/app/core/utils/wakfu-name.util';

const projectRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const REPOSITORY_DIR = path.join(projectRoot, 'repository');

/** Au-delà de ce nombre de familles distinctes parmi les ennemis, horde hétérogène — miroir de
 * `DISTINCT_FAMILY_THRESHOLD` (fight-image.util.ts). */
const DISTINCT_FAMILY_THRESHOLD = 4;
const NO_FAMILY_KEY = -1;

type WakfuDungeonType =
  | 'TWO_ROOMS'
  | 'THREE_ROOMS'
  | 'FOUR_ROOMS'
  | 'THREE_PLAYERS'
  | 'ULTIMATE_BOSS'
  | 'BREACH'
  | 'ULTIMATE_BREACH'
  | 'ARCADE';

/** Miroir de `ROOM_COUNT_BY_TYPE` (dungeon-run-grouping.util.ts). */
const ROOM_COUNT_BY_TYPE: Readonly<Record<WakfuDungeonType, number>> = {
  TWO_ROOMS: 2,
  THREE_ROOMS: 3,
  FOUR_ROOMS: 4,
  THREE_PLAYERS: 1,
  ULTIMATE_BOSS: 1,
  BREACH: 1,
  ULTIMATE_BREACH: 1,
  ARCADE: 1,
};

export interface DungeonEntry {
  id: number;
  bossMonsterId: number[];
  monsterFamilyId: number[];
  type: WakfuDungeonType;
  hasPreBossArchi: boolean;
}

interface MonsterEntry {
  id: number;
  family: number | null;
  isBoss: boolean;
  isArchi: boolean;
}

interface RawMonster {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
  family: number | null;
  isBoss: boolean;
  isArchi: boolean;
}

interface RawDungeon {
  id: number;
  bossMonsterId: number | number[] | null;
  monsterFamilyId: number | number[] | null;
  type: WakfuDungeonType;
  has_pre_boss_archi?: boolean;
}

function toIdArray(value: number | number[] | null | undefined): number[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export interface Catalog {
  findMonster(name: string): MonsterEntry | undefined;
  dungeons: readonly DungeonEntry[];
  dungeonsByBossMonsterId: Map<number, DungeonEntry>;
}

/** Charge repository/monsters.json + repository/dungeons.json et reconstruit les mêmes index que
 * `CatalogService.applyIndex`/`applyDungeons` — miroir de `backfill-monster-ids.ts` (voir sa doc). */
export async function loadCatalog(): Promise<Catalog> {
  const [rawMonsters, rawDungeons] = await Promise.all([
    readFile(path.join(REPOSITORY_DIR, 'monsters.json'), 'utf-8').then(
      (text) => JSON.parse(text) as RawMonster[],
    ),
    readFile(path.join(REPOSITORY_DIR, 'dungeons.json'), 'utf-8').then(
      (text) => JSON.parse(text) as RawDungeon[],
    ),
  ]);

  const byFrName = new Map<string, MonsterEntry>();
  const byOtherLocaleName = new Map<string, MonsterEntry>();
  for (const monster of rawMonsters) {
    const entry: MonsterEntry = {
      id: monster.id,
      family: monster.family,
      isBoss: monster.isBoss,
      isArchi: monster.isArchi,
    };
    const frKey = normalizeWakfuName(monster.fr);
    if (!byFrName.has(frKey)) byFrName.set(frKey, entry);
    for (const localized of [monster.en, monster.es, monster.pt]) {
      const key = normalizeWakfuName(localized);
      if (!byOtherLocaleName.has(key)) byOtherLocaleName.set(key, entry);
    }
  }

  const dungeons = rawDungeons.map((dungeon): DungeonEntry => ({
    id: dungeon.id,
    bossMonsterId: toIdArray(dungeon.bossMonsterId),
    monsterFamilyId: toIdArray(dungeon.monsterFamilyId),
    type: dungeon.type,
    hasPreBossArchi: dungeon.has_pre_boss_archi ?? false,
  }));

  const dungeonsByBossMonsterId = new Map<number, DungeonEntry>();
  for (const dungeon of dungeons) {
    for (const bossMonsterId of dungeon.bossMonsterId) {
      if (!dungeonsByBossMonsterId.has(bossMonsterId)) {
        dungeonsByBossMonsterId.set(bossMonsterId, dungeon);
      }
    }
  }

  return {
    findMonster: (name) =>
      byFrName.get(normalizeWakfuName(name)) ?? byOtherLocaleName.get(normalizeWakfuName(name)),
    dungeons,
    dungeonsByBossMonsterId,
  };
}

/** Port de `findDungeonForEnemies` (fight-image.util.ts) — voir sa doc pour l'ordre de priorité
 * (brèche ultime multi-boss > donjon d'un boss unique > brèche simple par familles). */
export function findDungeonForEnemyNames(
  catalog: Catalog,
  enemyNames: readonly string[],
): DungeonEntry | null {
  const entries = enemyNames
    .map((name) => catalog.findMonster(name))
    .filter((entry): entry is MonsterEntry => entry !== undefined);

  const bossEntries = entries.filter((entry) => entry.isBoss);
  const distinctBossIds = [...new Set(bossEntries.map((entry) => entry.id))];
  if (distinctBossIds.length > 1) {
    const ultimateBreach = catalog.dungeons.find(
      (dungeon) =>
        dungeon.type === 'ULTIMATE_BREACH' &&
        distinctBossIds.every((bossId) => dungeon.bossMonsterId.includes(bossId)),
    );
    if (ultimateBreach) return ultimateBreach;
  }

  for (const name of enemyNames) {
    const entry = catalog.findMonster(name);
    if (!entry?.isBoss) continue;
    const dungeon = catalog.dungeonsByBossMonsterId.get(entry.id);
    if (dungeon) return dungeon;
  }

  if (bossEntries.length === 0) {
    const distinctFamilies = new Set(entries.map((entry) => entry.family ?? NO_FAMILY_KEY));
    if (distinctFamilies.size > DISTINCT_FAMILY_THRESHOLD) {
      const enemyFamilyIds = [...distinctFamilies].filter((family) => family !== NO_FAMILY_KEY);
      const breach = catalog.dungeons.find(
        (dungeon) =>
          dungeon.type === 'BREACH' &&
          enemyFamilyIds.every((familyId) => dungeon.monsterFamilyId.includes(familyId)),
      );
      if (breach) return breach;
    }
  }

  return null;
}

export function hasArchiEnemy(catalog: Catalog, enemyNames: readonly string[]): boolean {
  return enemyNames.some((name) => catalog.findMonster(name)?.isArchi === true);
}

/** Port de `enemyCompositionKey` (dungeon-run-grouping.util.ts) — voir sa doc. */
export function enemyCompositionKey(enemyNames: readonly string[]): string {
  return [...new Set(enemyNames)].sort().join('|');
}

function dungeonRoomCount(dungeon: DungeonEntry): number {
  return ROOM_COUNT_BY_TYPE[dungeon.type];
}

export interface FightRow {
  id: number;
  startedAt: Date;
  result: 'won' | 'lost';
  dungeonId: number | null;
  dungeonRunKey: string | null;
  /** Donjon détecté à partir des SEULS ennemis de CE combat (mémoïsé une fois, avant le
   * regroupement) — `null` si aucun (salle sans boss, ou combat hors donjon). */
  dungeon: DungeonEntry | null;
  archi: boolean;
  /** Clé de composition d'ennemis (voir `enemyCompositionKey`) — utilisée à l'étape 3 de
   * `groupDungeonRuns` pour rattacher une défaite à la salle qu'elle a ratée. */
  roomKey: string;
}

type GroupEntry =
  | { kind: 'single'; record: FightRow }
  | { kind: 'dungeonRun'; dungeon: DungeonEntry; fights: FightRow[]; representative: FightRow };

/** Port de `groupDungeonRuns` (dungeon-run-grouping.util.ts) — voir sa doc pour le détail de
 * l'algorithme. `records` doit être trié du plus RÉCENT au plus ANCIEN. */
export function groupDungeonRuns(records: readonly FightRow[]): GroupEntry[] {
  const entries: GroupEntry[] = [];
  const consumed = new Array<boolean>(records.length).fill(false);

  for (let i = 0; i < records.length; i++) {
    if (consumed[i]) continue;

    const dungeon = records[i].dungeon;
    if (!dungeon) {
      entries.push({ kind: 'single', record: records[i] });
      consumed[i] = true;
      continue;
    }

    if (dungeonRoomCount(dungeon) === 1) {
      entries.push({ kind: 'single', record: records[i] });
      consumed[i] = true;
      continue;
    }

    let j = i + 1;
    while (j < records.length) {
      const candidate = records[j].dungeon;
      if (!candidate || candidate.id !== dungeon.id || records[j].result === 'won') break;
      j++;
    }

    if (dungeon.hasPreBossArchi && j < records.length && !records[j].dungeon && records[j].archi) {
      j++;
    }

    // Salles précédentes — miroir du fix 2026-08-30 de `groupDungeonRuns`
    // (dungeon-run-grouping.util.ts, voir sa doc pour le détail) : une VICTOIRE compte pour une
    // salle (sauf si `roomSlots` est déjà atteint : salle en trop = run antérieur distinct) ; une
    // DÉFAITE n'est ramassée comme tentative ratée de la salle EN COURS que si sa composition
    // d'ennemis correspond EXACTEMENT à celle de la victoire qui la referme.
    const roomSlots = dungeonRoomCount(dungeon) - 1;
    let roomsFound = 0;
    let currentRoomKey: string | null = null;
    while (j < records.length) {
      const candidate = records[j].dungeon;
      if (candidate) break;
      const record = records[j];
      if (record.result === 'won') {
        if (roomsFound >= roomSlots) break;
        currentRoomKey = record.roomKey;
        roomsFound++;
        j++;
        continue;
      }
      if (currentRoomKey !== null && record.roomKey === currentRoomKey) {
        j++;
        continue;
      }
      break;
    }

    for (let k = i; k < j; k++) consumed[k] = true;

    const span = records.slice(i, j);
    if (span.length <= 1) {
      entries.push({ kind: 'single', record: records[i] });
      continue;
    }

    entries.push({ kind: 'dungeonRun', dungeon, fights: span, representative: records[i] });
  }

  return entries;
}

interface FightUpdate {
  dungeonId: number;
  dungeonRunKey: string;
}

function mintRunKey(representativeFightId: number): string {
  return `migrated:${representativeFightId}`;
}

/** Calcule les mises à jour à appliquer pour un compte, sans rien écrire. */
export function resolveUpdatesForUser(
  rowsAscending: readonly FightRow[],
): Map<number, FightUpdate> {
  const updates = new Map<number, FightUpdate>();

  const descending = [...rowsAscending].reverse();
  for (const entry of groupDungeonRuns(descending)) {
    if (entry.kind === 'single') {
      if (entry.record.dungeon !== null && entry.record.dungeonId === null) {
        const key = entry.record.dungeonRunKey ?? mintRunKey(entry.record.id);
        updates.set(entry.record.id, { dungeonId: entry.record.dungeon.id, dungeonRunKey: key });
      }
      continue;
    }

    const existingKey = entry.fights.map((f) => f.dungeonRunKey).find((k) => k !== null) ?? null;
    const key = existingKey ?? mintRunKey(entry.representative.id);
    for (const fight of entry.fights) {
      if (fight.dungeonId === null) {
        updates.set(fight.id, { dungeonId: entry.dungeon.id, dungeonRunKey: key });
      }
    }
  }

  return updates;
}

async function applyUpdates(
  db: ReturnType<typeof createDb>,
  userId: string,
  updates: Map<number, FightUpdate>,
): Promise<void> {
  const rows = [...updates.entries()];
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = sql.join(
      chunk.map(
        ([id, v]) => sql`(${id}::bigint, ${v.dungeonId}::integer, ${v.dungeonRunKey}::text)`,
      ),
      sql`, `,
    );
    // `f.dungeon_id is null` : même garde qu'à la lecture, jamais un combat déjà rattaché — voir
    // doc de tête (idempotence).
    await db.execute(sql`
      update fights as f
      set dungeon_id = v.dungeon_id, dungeon_run_key = v.dungeon_run_key
      from (values ${values}) as v(id, dungeon_id, dungeon_run_key)
      where f.id = v.id and f.user_id = ${userId} and f.dungeon_id is null
    `);
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL manquant.');
  const apply = process.argv.includes('--apply');
  const verbose = process.argv.includes('--verbose');
  const userArg = process.argv.find((arg) => arg.startsWith('--user='));
  const onlyUserId = userArg ? userArg.slice('--user='.length) : null;

  const catalog = await loadCatalog();
  const db = createDb(databaseUrl);

  const userIds = onlyUserId
    ? [onlyUserId]
    : (
        await db
          .selectDistinct({ userId: fights.userId })
          .from(fights)
          .where(isNull(fights.dungeonId))
      ).map((row) => row.userId);

  console.log(`[backfill-dungeon-runs] ${userIds.length} compte(s) à examiner.`);

  let usersWithUpdates = 0;
  let totalFightsUpdated = 0;
  let totalNullWon = 0;

  for (const userId of userIds) {
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

    if (rows.length === 0) continue;

    const enemyNamesByFightId = new Map<number, string[]>();
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const idsChunk = rows.slice(i, i + CHUNK).map((r) => r.id);
      const participantRows = await db
        .select({ fightId: fightParticipants.fightId, name: fightParticipants.name })
        .from(fightParticipants)
        .where(
          and(eq(fightParticipants.side, 'enemy'), inArray(fightParticipants.fightId, idsChunk)),
        );
      for (const p of participantRows) {
        const list = enemyNamesByFightId.get(p.fightId) ?? [];
        list.push(p.name);
        enemyNamesByFightId.set(p.fightId, list);
      }
    }

    const fightRows: FightRow[] = rows.map((row) => {
      if (row.won === null) totalNullWon++;
      const enemyNames = enemyNamesByFightId.get(row.id) ?? [];
      return {
        id: row.id,
        startedAt: row.startedAt,
        // `won === null` (rare, jamais produit par le client actuel) traité prudemment comme une
        // défaite pour l'algorithme de regroupement — ne peut jamais faire croire à tort qu'une
        // salle antérieure appartient déjà à un run précédent distinct (voir groupDungeonRuns,
        // étape 1 : seule une VICTOIRE plus ancienne coupe le cluster de tentatives de boss).
        result: row.won === true ? 'won' : 'lost',
        dungeonId: row.dungeonId,
        dungeonRunKey: row.dungeonRunKey,
        dungeon: findDungeonForEnemyNames(catalog, enemyNames),
        archi: hasArchiEnemy(catalog, enemyNames),
        roomKey: enemyCompositionKey(enemyNames),
      };
    });

    const updates = resolveUpdatesForUser(fightRows);
    if (updates.size === 0) continue;

    usersWithUpdates++;
    totalFightsUpdated += updates.size;
    console.log(
      `[backfill-dungeon-runs] compte ${userId} : ${updates.size} combat(s) à rattacher.`,
    );

    const entries = [...updates.entries()];
    const sample = verbose ? entries : entries.slice(0, 20);
    for (const [fightId, update] of sample) {
      console.log(
        `  ${apply ? 'UPDATE' : '[dry-run]'} fight #${fightId} -> dungeon_id=${update.dungeonId}, dungeon_run_key=${update.dungeonRunKey}`,
      );
    }
    if (!verbose && entries.length > sample.length) {
      console.log(`  ... et ${entries.length - sample.length} de plus (--verbose pour tout voir).`);
    }

    if (apply) {
      await applyUpdates(db, userId, updates);
    }
  }

  console.log(
    `[backfill-dungeon-runs] Terminé — ${usersWithUpdates} compte(s) concerné(s), ${totalFightsUpdated} combat(s) ${apply ? 'mis à jour' : 'à mettre à jour'}.`,
  );
  if (totalNullWon > 0) {
    console.log(
      `[backfill-dungeon-runs] Note : ${totalNullWon} combat(s) avec won=NULL rencontré(s), traité(s) comme défaite pour le regroupement.`,
    );
  }
  if (!apply) {
    console.log('[backfill-dungeon-runs] Dry-run — relancer avec --apply pour écrire réellement.');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
