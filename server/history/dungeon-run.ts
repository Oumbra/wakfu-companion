import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { dungeons, fightParticipants, fights, monsters, type WakfuDungeonType } from '../db/schema';
import { normalizeWakfuName } from '../../src/app/core/utils/wakfu-name.util';

/**
 * Regroupement de combats de donjon multi-salles (`fights.dungeonId`/`dungeonRunKey`) — **côté
 * serveur**, en complément du calcul client (`dungeon-run-grouping.util.ts` côté web,
 * `dungeon_run.rs` côté overlay). Les deux clients portent déjà l'algorithme complet
 * (`findDungeonForEnemies`/`groupDungeonRuns`), mais uniquement sur l'historique de LEUR SESSION
 * LOCALE en cours — un run réparti entre web et overlay (changement de client en plein donjon),
 * ou une salle dont le boss n'a plus jamais été rejoué dans la même session, n'est alors
 * correctement regroupé par AUCUN des deux calculs client. Le serveur, lui, voit tout l'historique
 * du compte, peu importe le client d'origine — ce module recalcule donc le même regroupement en
 * AUTORITÉ, après chaque envoi (`functions/api/v1/history/fights.ts`), en complément (jamais en
 * remplacement) du rattachement déjà envoyé par le client.
 *
 * Port direct de `server/import/backfill-dungeon-runs.ts` (script de rattrapage manuel préexistant,
 * qui portait déjà tout cet algorithme côté serveur mais uniquement en TS/JSON, jamais branché en
 * synchrone) — les fonctions pures (`findDungeonForEnemyNames`/`groupDungeonRuns`/
 * `resolveUpdatesForUser`) sont extraites ici telles quelles, réutilisées par les deux appelants
 * (POST live et script) pour ne jamais diverger. Voir la doc de tête de ce script pour le détail
 * de l'algorithme (non redupliquée ligne à ligne ici) et le format de `dungeonRunKey`
 * (`migrated:<id>` quand aucune vraie signature client n'est encore connue pour le run).
 *
 * **`loadCatalogFromDb` remplace `loadCatalog` (lecture `repository/*.json` via `node:fs/promises`)
 * du script** : ce module est importé depuis `functions/api/v1/history/fights.ts`, qui tourne dans
 * le runtime Cloudflare Pages Functions (Workers) — pas d'accès `fs` là-bas. `dungeons`/`monsters`
 * sont déjà en base (mêmes tables que `server/history/fight-type.ts`), tables petites (151/851
 * lignes) : un aller-retour DB négligeable remplace la lecture JSON.
 */

const DISTINCT_FAMILY_THRESHOLD = 4;
const NO_FAMILY_KEY = -1;

/** Miroir de `ROOM_COUNT_BY_TYPE` (`dungeon-run-grouping.util.ts`). */
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

/** Nombre de combats du compte à charger en arrière (par `startedAt` décroissant) avant de tenter
 * un regroupement — marge large au-dessus du plus grand run réel possible (`FOUR_ROOMS` + archi
 * pré-boss + tentatives répétées ≈ une dizaine de combats), sans jamais scanner tout l'historique
 * du compte à chaque envoi (voir `recomputeDungeonRunsForBatch`, gating avant ce coût). */
const LOOKBACK_FIGHTS = 100;

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

export interface Catalog {
  findMonster(name: string): MonsterEntry | undefined;
  dungeons: readonly DungeonEntry[];
  dungeonsByBossMonsterId: Map<number, DungeonEntry>;
}

/** Charge `dungeons`/`monsters` déjà en base et reconstruit les mêmes index que `loadCatalog`
 * (script, lecture JSON) — voir la doc de tête de ce module pour pourquoi ce chemin-ci plutôt que
 * `node:fs/promises` ici. */
export async function loadCatalogFromDb(db: Db): Promise<Catalog> {
  const [monsterRows, dungeonRows] = await Promise.all([
    db
      .select({
        id: monsters.id,
        fr: monsters.fr,
        en: monsters.en,
        es: monsters.es,
        pt: monsters.pt,
        family: monsters.family,
        isBoss: monsters.isBoss,
        isArchi: monsters.isArchi,
      })
      .from(monsters),
    db
      .select({
        id: dungeons.id,
        bossMonsterId: dungeons.bossMonsterId,
        monsterFamilyId: dungeons.monsterFamilyId,
        type: dungeons.type,
        hasPreBossArchi: dungeons.hasPreBossArchi,
      })
      .from(dungeons),
  ]);

  const byFrName = new Map<string, MonsterEntry>();
  const byOtherLocaleName = new Map<string, MonsterEntry>();
  for (const monster of monsterRows) {
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

  const dungeonEntries: DungeonEntry[] = dungeonRows.map((dungeon) => ({
    id: dungeon.id,
    bossMonsterId: dungeon.bossMonsterId,
    monsterFamilyId: dungeon.monsterFamilyId,
    type: dungeon.type,
    hasPreBossArchi: dungeon.hasPreBossArchi,
  }));

  const dungeonsByBossMonsterId = new Map<number, DungeonEntry>();
  for (const dungeon of dungeonEntries) {
    for (const bossMonsterId of dungeon.bossMonsterId) {
      if (!dungeonsByBossMonsterId.has(bossMonsterId)) {
        dungeonsByBossMonsterId.set(bossMonsterId, dungeon);
      }
    }
  }

  return {
    findMonster: (name) =>
      byFrName.get(normalizeWakfuName(name)) ?? byOtherLocaleName.get(normalizeWakfuName(name)),
    dungeons: dungeonEntries,
    dungeonsByBossMonsterId,
  };
}

/** Port de `findDungeonForEnemies` (`fight-image.util.ts`) — voir sa doc pour l'ordre de priorité
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

/** Port de `enemyCompositionKey` (`dungeon-run-grouping.util.ts`) — voir sa doc. */
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

/** Port de `groupDungeonRuns` (`dungeon-run-grouping.util.ts`) — voir sa doc pour le détail de
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

/** Clé synthétique déterministe, jamais un vrai `sha256` (64 caractères hex) — ne peut donc jamais
 * collisionner avec une clé produite par un client (`computeClientKey`) si ce même run est un jour
 * réidentifié par le client avec sa signature exacte. */
export function mintRunKey(representativeFightId: number): string {
  return `migrated:${representativeFightId}`;
}

/** Calcule les mises à jour à appliquer pour un ensemble de combats, sans rien écrire — jamais un
 * combat déjà rattaché (`dungeonId !== null`), même garde que le script de rattrapage. */
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

/** Écrit un lot de rattachements calculés (`resolveUpdatesForUser`) — exportée pour être réutilisée
 * telle quelle par `server/import/backfill-dungeon-runs.ts` (script de rattrapage). */
export async function applyDungeonRunUpdates(
  db: Db,
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
    // `f.dungeon_id is null` : jamais un combat déjà rattaché (même garde que le script de
    // rattrapage) — idempotent, un rejeu ne trouve alors plus rien à faire.
    await db.execute(sql`
      update fights as f
      set dungeon_id = v.dungeon_id, dungeon_run_key = v.dungeon_run_key
      from (values ${values}) as v(id, dungeon_id, dungeon_run_key)
      where f.id = v.id and f.user_id = ${userId} and f.dungeon_id is null
    `);
  }
}

/**
 * Recalcule le regroupement de donjon en autorité pour un lot venant d'être écrit
 * (`functions/api/v1/history/fights.ts`, POST) — appelée APRÈS l'écriture de `fight_participants`
 * (même position que le bloc `fight_type`), sur TOUT le lot (nouveaux combats comme déjà connus,
 * un combat déjà connu pouvant être renvoyé uniquement pour son rattachement).
 *
 * **Filtre d'abord, cher ensuite** : le payload d'un `POST` peut arriver toutes les ~2s en session
 * active (`SYNC_BATCH_SIZE`/debounce client) — hors de question de rejouer `groupDungeonRuns` sur
 * une fenêtre de l'historique à CHAQUE envoi. Seuls les combats qui révèlent EUX-MÊMES un donjon
 * (boss ou brèche, résolu sur leurs propres ennemis, déjà en mémoire pour ce lot — aucune requête
 * supplémentaire) déclenchent la suite : c'est le seul cas qui peut avoir de nouvelles salles à
 * rattacher (une salle seule, sans son boss, n'a structurellement rien à regrouper avant que le
 * boss n'apparaisse). Si aucun combat du lot n'en révèle : retour immédiat, seul le chargement du
 * catalogue (`loadCatalogFromDb`, déjà fait par l'appelant, tables petites) est payé.
 *
 * Sinon : charge une fenêtre BORNÉE (`LOOKBACK_FIGHTS` derniers combats du compte,
 * `fights_user_started_at_idx` déjà indexé) + leurs participants ennemis, fusionne avec le lot
 * courant, rejoue `groupDungeonRuns`/`resolveUpdatesForUser` dessus, écrit le delta.
 */
export async function recomputeDungeonRunsForBatch(
  db: Db,
  userId: string,
  catalog: Catalog,
  touchedFights: readonly {
    id: number;
    startedAt: Date;
    won: boolean | null;
    dungeonId: number | null;
    dungeonRunKey: string | null;
    enemyNames: readonly string[];
  }[],
): Promise<void> {
  const toFightRow = (row: {
    id: number;
    startedAt: Date;
    won: boolean | null;
    dungeonId: number | null;
    dungeonRunKey: string | null;
    enemyNames: readonly string[];
  }): FightRow => ({
    id: row.id,
    startedAt: row.startedAt,
    // `won === null` (rare) traité prudemment comme une défaite — ne peut jamais faire croire à
    // tort qu'une salle antérieure appartient déjà à un run précédent distinct (voir
    // `groupDungeonRuns`, étape 1 : seule une VICTOIRE plus ancienne coupe le cluster).
    result: row.won === true ? 'won' : 'lost',
    dungeonId: row.dungeonId,
    dungeonRunKey: row.dungeonRunKey,
    dungeon: findDungeonForEnemyNames(catalog, row.enemyNames),
    archi: hasArchiEnemy(catalog, row.enemyNames),
    roomKey: enemyCompositionKey(row.enemyNames),
  });

  const touchedRows = touchedFights.map(toFightRow);
  const revealsDungeon = touchedRows.some((row) => row.dungeon !== null);
  if (!revealsDungeon) return;

  const lookbackRows = await db
    .select({
      id: fights.id,
      startedAt: fights.startedAt,
      won: fights.won,
      dungeonId: fights.dungeonId,
      dungeonRunKey: fights.dungeonRunKey,
    })
    .from(fights)
    .where(eq(fights.userId, userId))
    .orderBy(desc(fights.startedAt), desc(fights.id))
    .limit(LOOKBACK_FIGHTS);

  const touchedIds = new Set(touchedRows.map((row) => row.id));
  const lookbackIds = lookbackRows.map((row) => row.id).filter((id) => !touchedIds.has(id));

  const enemyNamesByFightId = new Map<number, string[]>();
  const CHUNK = 500;
  for (let i = 0; i < lookbackIds.length; i += CHUNK) {
    const idsChunk = lookbackIds.slice(i, i + CHUNK);
    if (idsChunk.length === 0) continue;
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

  const lookbackFightRows: FightRow[] = lookbackRows
    .filter((row) => !touchedIds.has(row.id))
    .map((row) =>
      toFightRow({
        id: row.id,
        startedAt: row.startedAt,
        won: row.won,
        dungeonId: row.dungeonId,
        dungeonRunKey: row.dungeonRunKey,
        enemyNames: enemyNamesByFightId.get(row.id) ?? [],
      }),
    );

  const allRowsAscending = [...lookbackFightRows, ...touchedRows].sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id - b.id,
  );

  const updates = resolveUpdatesForUser(allRowsAscending);
  if (updates.size === 0) return;
  await applyDungeonRunUpdates(db, userId, updates);
}
