import { describe, expect, it } from 'vitest';
import { groupDungeonRuns, DungeonGroupableFight } from './dungeon-run-grouping.util';
import { CatalogDungeonEntry } from '../api/catalog.service';

interface TestFight extends DungeonGroupableFight {
  label: string;
  bossOf: number | null; // id de donjon dont ce combat contient le boss, ou null
}

function fight(id: number, label: string, result: 'won' | 'lost', bossOf: number | null): TestFight {
  return { id, label, result, bossOf };
}

function makeDungeon(overrides: Partial<CatalogDungeonEntry> & { id: number }): CatalogDungeonEntry {
  return {
    fr: `Donjon ${overrides.id}`,
    en: `Dungeon ${overrides.id}`,
    es: `Mazmorra ${overrides.id}`,
    pt: `Masmorra ${overrides.id}`,
    level: 1,
    bracket: 1,
    type: 'ULTIMATE_BOSS', // type "1 seul combat" par défaut (équivalent de l'ancien roomCount=null)
    bossMonsterId: 900 + overrides.id,
    pictureUrl: `https://example.test/dungeon-${overrides.id}.png`,
    wakassetsAvailable: true,
    hasPreBossArchi: false,
    ...overrides,
  };
}

const DUNGEON_A = makeDungeon({ id: 1, type: 'THREE_ROOMS' });
const DUNGEON_B = makeDungeon({ id: 2, type: 'TWO_ROOMS' });
const DUNGEON_ARCHI = makeDungeon({ id: 3, hasPreBossArchi: true });

function findDungeon(record: TestFight): CatalogDungeonEntry | null {
  if (record.bossOf === DUNGEON_A.id) return DUNGEON_A;
  if (record.bossOf === DUNGEON_B.id) return DUNGEON_B;
  if (record.bossOf === DUNGEON_ARCHI.id) return DUNGEON_ARCHI;
  return null;
}

describe('groupDungeonRuns', () => {
  it('laisse un combat sans donjon reconnu en entrée single', () => {
    const records = [fight(1, 'Combat isolé', 'won', null)];
    expect(groupDungeonRuns(records, findDungeon)).toEqual([{ kind: 'single', record: records[0] }]);
  });

  it("laisse un boss gagné du premier coup sans salle rattachable en entrée single (type à 1 combat)", () => {
    const records = [fight(1, 'Boss ultime', 'won', DUNGEON_ARCHI.id)];
    // DUNGEON_ARCHI a type ULTIMATE_BOSS (1 combat) mais hasPreBossArchi=true -> 1 salle attendue ;
    // ici aucun combat précédent n'existe (début du tableau), donc rien à rattacher.
    expect(groupDungeonRuns(records, findDungeon)).toEqual([{ kind: 'single', record: records[0] }]);
  });

  it('regroupe les salles précédentes avec le combat de boss (donjon 3 salles = 2 salles + boss)', () => {
    // Ordre plus récent -> plus ancien (comme mergedFights) : boss puis les 2 salles.
    const boss = fight(3, 'Boss A', 'won', DUNGEON_A.id);
    const room2 = fight(2, 'Salle 2', 'won', null);
    const room1 = fight(1, 'Salle 1', 'won', null);
    const records = [boss, room2, room1];

    const result = groupDungeonRuns(records, findDungeon);

    expect(result).toEqual([
      {
        kind: 'dungeonRun',
        dungeon: DUNGEON_A,
        fights: [room1, room2, boss], // chronologique : plus ancien -> plus récent
        representative: boss,
      },
    ]);
  });

  it('regroupe les tentatives de boss consécutives (défaites) jusqu\'à la première victoire', () => {
    const win = fight(4, 'Boss A - victoire', 'won', DUNGEON_A.id);
    const lose2 = fight(3, 'Boss A - défaite 2', 'lost', DUNGEON_A.id);
    const lose1 = fight(2, 'Boss A - défaite 1', 'lost', DUNGEON_A.id);
    const room1 = fight(1, 'Salle 1', 'won', null);
    const records = [win, lose2, lose1, room1];

    const result = groupDungeonRuns(records, findDungeon);

    expect(result).toEqual([
      {
        kind: 'dungeonRun',
        dungeon: DUNGEON_A,
        fights: [room1, lose1, lose2, win],
        representative: win,
      },
    ]);
  });

  it("garde-fou : n'avale pas le combat de boss d'un run antérieur distinct comme si c'était une salle", () => {
    // Un 2e donjon (B, type TWO_ROOMS) juste après la fin du run du donjon A ne doit jamais être
    // considéré comme une "salle" du donjon A, même par pure adjacence.
    const bossA = fight(3, 'Boss A', 'won', DUNGEON_A.id);
    const bossB = fight(2, 'Boss B (run antérieur distinct)', 'won', DUNGEON_B.id);
    const roomB = fight(1, 'Salle du donjon B', 'won', null);
    const records = [bossA, bossB, roomB];

    const result = groupDungeonRuns(records, findDungeon);

    // bossA reste seul (aucune salle rattachée, bossB appartient à un autre donjon) ; bossB+roomB
    // forment leur propre groupe (donjon B, TWO_ROOMS = 1 salle + boss).
    expect(result).toEqual([
      { kind: 'single', record: bossA },
      {
        kind: 'dungeonRun',
        dungeon: DUNGEON_B,
        fights: [roomB, bossB],
        representative: bossB,
      },
    ]);
  });

  it('ajoute une salle supplémentaire pour un donjon avec archimonstre pré-boss (hasPreBossArchi)', () => {
    const boss = fight(2, 'Boss archi', 'won', DUNGEON_ARCHI.id);
    const archi = fight(1, 'Archimonstre pré-boss', 'won', null);
    const records = [boss, archi];

    const result = groupDungeonRuns(records, findDungeon);

    expect(result).toEqual([
      {
        kind: 'dungeonRun',
        dungeon: DUNGEON_ARCHI,
        fights: [archi, boss],
        representative: boss,
      },
    ]);
  });

  it("s'arrête sans erreur si moins de salles que prévu sont disponibles (début de l'historique)", () => {
    // Donjon 3 salles (type THREE_ROOMS, 2 salles attendues) mais une seule salle disponible avant le
    // boss dans l'historique fourni (garde-fou : ne doit pas planter, ni sortir du tableau).
    const boss = fight(2, 'Boss A', 'won', DUNGEON_A.id);
    const room1 = fight(1, 'Seule salle disponible', 'won', null);
    const records = [boss, room1];

    const result = groupDungeonRuns(records, findDungeon);

    expect(result).toEqual([
      {
        kind: 'dungeonRun',
        dungeon: DUNGEON_A,
        fights: [room1, boss],
        representative: boss,
      },
    ]);
  });
});
