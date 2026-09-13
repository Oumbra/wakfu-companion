import { describe, expect, it } from 'vitest';
import {
  enemyCompositionKey,
  findDungeonForEnemyNames,
  groupDungeonRuns,
  mintRunKey,
  resolveUpdatesForUser,
  type Catalog,
  type DungeonEntry,
  type FightRow,
  type MonsterEntry,
} from './dungeon-run';
import { indexDungeonsByBossMonsterId } from '../../src/app/core/utils/dungeon-boss-index.util';

/**
 * Cas repris de `src/app/core/utils/dungeon-run-grouping.util.spec.ts` (même algorithme, même
 * comportement attendu) — adaptés à l'API `FightRow[]` de ce module (donjon/archi/roomKey déjà
 * résolus par l'appelant, comme le fait déjà `server/import/backfill-dungeon-runs.ts`) plutôt qu'à
 * l'injection de fonctions `findDungeon`/`hasArchiEnemy`/`roomCompositionKey` du pendant client.
 */

function makeDungeon(overrides: Partial<DungeonEntry> & { id: number }): DungeonEntry {
  return {
    bossMonsterId: [900 + overrides.id],
    monsterFamilyId: [800 + overrides.id],
    type: 'ULTIMATE_BOSS',
    hasPreBossArchi: false,
    ...overrides,
  };
}

const DUNGEON_A = makeDungeon({ id: 1, type: 'THREE_ROOMS' });
const DUNGEON_B = makeDungeon({ id: 2, type: 'TWO_ROOMS' });
const DUNGEON_ARCHI = makeDungeon({ id: 3, type: 'FOUR_ROOMS', hasPreBossArchi: true });
const DUNGEON_ONE_ROOM = makeDungeon({ id: 4, type: 'ULTIMATE_BOSS' });

let nextTime = 0;
/** Horodatage croissant unique par appel — seul l'ORDRE relatif compte pour ces tests (les
 * fixtures sont déjà passées triées plus récent -> plus ancien à `groupDungeonRuns`, comme
 * `resolveUpdatesForUser` le fait après avoir inversé un tri ascendant). */
function nextStartedAt(): Date {
  nextTime += 1000;
  return new Date(nextTime);
}

function row(
  id: number,
  result: 'won' | 'lost',
  dungeon: DungeonEntry | null,
  options: {
    archi?: boolean;
    roomKey?: string;
    dungeonId?: number | null;
    dungeonRunKey?: string | null;
  } = {},
): FightRow {
  return {
    id,
    startedAt: nextStartedAt(),
    result,
    dungeonId: options.dungeonId ?? null,
    dungeonRunKey: options.dungeonRunKey ?? null,
    dungeon,
    archi: options.archi ?? false,
    roomKey: options.roomKey ?? `unique:${id}`,
  };
}

describe('groupDungeonRuns', () => {
  it('laisse un combat sans donjon reconnu en entrée single', () => {
    const records = [row(1, 'won', null)];
    expect(groupDungeonRuns(records)).toEqual([{ kind: 'single', record: records[0] }]);
  });

  it('un donjon à 1 combat ne regroupe jamais, même après des défaites répétées', () => {
    const win = row(3, 'won', DUNGEON_ONE_ROOM);
    const lose2 = row(2, 'lost', DUNGEON_ONE_ROOM);
    const lose1 = row(1, 'lost', DUNGEON_ONE_ROOM);
    const records = [win, lose2, lose1];

    expect(groupDungeonRuns(records)).toEqual([
      { kind: 'single', record: win },
      { kind: 'single', record: lose2 },
      { kind: 'single', record: lose1 },
    ]);
  });

  it('regroupe les salles précédentes avec le combat de boss (3 salles = 2 salles + boss)', () => {
    const boss = row(3, 'won', DUNGEON_A);
    const room2 = row(2, 'won', null);
    const room1 = row(1, 'won', null);
    const records = [boss, room2, room1];

    expect(groupDungeonRuns(records)).toEqual([
      {
        kind: 'dungeonRun',
        dungeon: DUNGEON_A,
        fights: [boss, room2, room1],
        representative: boss,
      },
    ]);
  });

  it("regroupe les tentatives de boss consécutives (défaites) jusqu'à la première victoire", () => {
    const win = row(4, 'won', DUNGEON_A);
    const lose2 = row(3, 'lost', DUNGEON_A);
    const lose1 = row(2, 'lost', DUNGEON_A);
    const room1 = row(1, 'won', null);
    const records = [win, lose2, lose1, room1];

    expect(groupDungeonRuns(records)).toEqual([
      {
        kind: 'dungeonRun',
        dungeon: DUNGEON_A,
        fights: [win, lose2, lose1, room1],
        representative: win,
      },
    ]);
  });

  it("garde-fou : n'avale pas le combat de boss d'un run antérieur distinct comme si c'était une salle", () => {
    const bossA = row(3, 'won', DUNGEON_A);
    const bossB = row(2, 'won', DUNGEON_B);
    const roomB = row(1, 'won', null);
    const records = [bossA, bossB, roomB];

    expect(groupDungeonRuns(records)).toEqual([
      { kind: 'single', record: bossA },
      { kind: 'dungeonRun', dungeon: DUNGEON_B, fights: [bossB, roomB], representative: bossB },
    ]);
  });

  it('ajoute un créneau archimonstre pré-boss uniquement si réellement présent (bug corrigé côté web)', () => {
    const boss = row(2, 'won', DUNGEON_ARCHI);
    const archi = row(1, 'won', null, { archi: true });
    expect(groupDungeonRuns([boss, archi])).toEqual([
      { kind: 'dungeonRun', dungeon: DUNGEON_ARCHI, fights: [boss, archi], representative: boss },
    ]);
  });

  it("n'ajoute PAS de créneau archimonstre si le combat qui précède le boss n'en contient pas", () => {
    const boss = row(4, 'won', DUNGEON_ARCHI);
    const room3 = row(3, 'won', null);
    const room2 = row(2, 'won', null);
    const room1 = row(1, 'won', null);
    const records = [boss, room3, room2, room1];

    expect(groupDungeonRuns(records)).toEqual([
      {
        kind: 'dungeonRun',
        dungeon: DUNGEON_ARCHI,
        fights: [boss, room3, room2, room1],
        representative: boss,
      },
    ]);
  });

  it("rattache TOUTES les défaites d'une salle retentée à cette salle, sans perdre une salle plus ancienne", () => {
    const boss = row(5, 'won', DUNGEON_ARCHI);
    const room3 = row(4, 'won', null);
    const room2Win = row(3, 'won', null, { roomKey: 'room2' });
    const room2Lost = row(2, 'lost', null, { roomKey: 'room2' });
    const room1 = row(1, 'won', null);
    const records = [boss, room3, room2Win, room2Lost, room1];

    expect(groupDungeonRuns(records)).toEqual([
      {
        kind: 'dungeonRun',
        dungeon: DUNGEON_ARCHI,
        fights: [boss, room3, room2Win, room2Lost, room1],
        representative: boss,
      },
    ]);
  });

  it("NE rattache PAS une défaite dont la composition d'ennemis diffère de la victoire adjacente", () => {
    const boss = row(3, 'won', DUNGEON_B);
    const room1Win = row(2, 'won', null, { roomKey: 'room1' });
    const unrelatedLoss = row(1, 'lost', null); // roomKey unique par défaut : composition différente
    const records = [boss, room1Win, unrelatedLoss];

    expect(groupDungeonRuns(records)).toEqual([
      { kind: 'dungeonRun', dungeon: DUNGEON_B, fights: [boss, room1Win], representative: boss },
      { kind: 'single', record: unrelatedLoss },
    ]);
  });
});

describe('resolveUpdatesForUser', () => {
  it("réutilise la clé déjà connue du run (posée par un envoi client antérieur) plutôt que d'en forger une nouvelle", () => {
    const boss = row(2, 'won', DUNGEON_B, { dungeonId: 2, dungeonRunKey: 'a'.repeat(64) });
    const room1 = row(1, 'won', null); // pas encore rattachée
    const rowsAscending = [room1, boss];

    const updates = resolveUpdatesForUser(rowsAscending);

    expect(updates.get(1)).toEqual({ dungeonId: DUNGEON_B.id, dungeonRunKey: 'a'.repeat(64) });
    // Le boss est déjà rattaché (`dungeonId` non null) : jamais réécrit.
    expect(updates.has(2)).toBe(false);
  });

  it("forge une clé synthétique migrated:<id> quand aucun combat du run n'a encore de vraie signature", () => {
    const boss = row(2, 'won', DUNGEON_B);
    const room1 = row(1, 'won', null);
    const rowsAscending = [room1, boss];

    const updates = resolveUpdatesForUser(rowsAscending);

    expect(updates.get(2)).toEqual({ dungeonId: DUNGEON_B.id, dungeonRunKey: mintRunKey(2) });
    expect(updates.get(1)).toEqual({ dungeonId: DUNGEON_B.id, dungeonRunKey: mintRunKey(2) });
  });

  it('ne renvoie aucune mise à jour pour un combat déjà entièrement rattaché', () => {
    const boss = row(1, 'won', DUNGEON_B, { dungeonId: 2, dungeonRunKey: 'a'.repeat(64) });
    expect(resolveUpdatesForUser([boss]).size).toBe(0);
  });
});

describe('enemyCompositionKey', () => {
  it('ignore ordre et doublons', () => {
    expect(enemyCompositionKey(['B', 'A', 'B'])).toBe(enemyCompositionKey(['A', 'B']));
    expect(enemyCompositionKey(['A', 'B'])).not.toBe(enemyCompositionKey(['A', 'C']));
  });
});

describe('findDungeonForEnemyNames — boss partagé entre donjon classique et brèche ultime', () => {
  const FLAQUEUX: DungeonEntry = makeDungeon({ id: 142, type: 'TWO_ROOMS', bossMonsterId: [4720] });
  const CACTERRE: DungeonEntry = makeDungeon({ id: 83, type: 'TWO_ROOMS', bossMonsterId: [2972] });
  const FRIGOST_ULTIMATE: DungeonEntry = makeDungeon({
    id: 170,
    type: 'ULTIMATE_BREACH',
    bossMonsterId: [2464, 2972, 4720],
  });
  const MONSTERS = new Map<string, MonsterEntry>([
    ['flaque royale', { id: 4720, family: 12, isBoss: true, isArchi: false }],
    ['chef flaqueux', { id: 4717, family: 12, isBoss: false, isArchi: false }],
    ['cacterre boss', { id: 2972, family: 107, isBoss: true, isArchi: false }],
  ]);

  function catalogInOrder(dungeons: DungeonEntry[]): Catalog {
    return {
      findMonster: (name) => MONSTERS.get(name.toLowerCase()),
      dungeons,
      // Même construction que `loadCatalogFromDb`/`backfill-dungeon-runs.ts::loadCatalog`.
      dungeonsByBossMonsterId: indexDungeonsByBossMonsterId(dungeons),
    };
  }

  it('rattache un boss seul à son donjon classique même si la brèche ultime le précède', () => {
    // Bug réel corrigé le 2026-09-13 : `db.select().from(dungeons)` (sans ORDER BY) pouvait
    // renvoyer la brèche ultime avant le donjon classique — 57 combats en prod rattachés à
    // « Brèche dimensionnelle de Frigost » avec un seul boss (Flaque Royale seule, etc.).
    const catalog = catalogInOrder([FRIGOST_ULTIMATE, FLAQUEUX, CACTERRE]);

    expect(findDungeonForEnemyNames(catalog, ['Chef Flaqueux', 'Flaque Royale'])?.id).toBe(142);
  });

  it('résout toujours la brèche ultime quand PLUSIEURS de ses boss sont présents', () => {
    const catalog = catalogInOrder([FLAQUEUX, CACTERRE, FRIGOST_ULTIMATE]);

    expect(findDungeonForEnemyNames(catalog, ['Flaque Royale', 'Cacterre Boss'])?.id).toBe(170);
  });
});
