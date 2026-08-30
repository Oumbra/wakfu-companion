import { describe, expect, it } from 'vitest';
import { groupDungeonRuns, DungeonGroupableFight } from './dungeon-run-grouping.util';
import { CatalogDungeonEntry } from '../api/catalog.service';

interface TestFight extends DungeonGroupableFight {
  label: string;
  bossOf: number | null; // id de donjon dont ce combat contient le boss, ou null
  hasArchi?: boolean; // combat (non-boss) contenant un archimonstre
  /** Clé de composition d'ennemis (voir `enemyCompositionKey`) — deux combats d'une MÊME salle
   * (une victoire et ses tentatives ratées) doivent partager la même valeur ; par défaut, une
   * valeur unique dérivée de `label` (jamais de collision accidentelle entre combats non liés). */
  roomKey?: string;
}

function fight(
  id: number,
  label: string,
  result: 'won' | 'lost',
  bossOf: number | null,
  options: { hasArchi?: boolean; roomKey?: string } = {},
): TestFight {
  return {
    id,
    label,
    result,
    bossOf,
    hasArchi: options.hasArchi ?? false,
    roomKey: options.roomKey,
  };
}

function makeDungeon(
  overrides: Partial<CatalogDungeonEntry> & { id: number },
): CatalogDungeonEntry {
  return {
    fr: `Donjon ${overrides.id}`,
    en: `Dungeon ${overrides.id}`,
    es: `Mazmorra ${overrides.id}`,
    pt: `Masmorra ${overrides.id}`,
    level: 1,
    bracket: 1,
    type: 'ULTIMATE_BOSS', // type "1 seul combat" par défaut (équivalent de l'ancien roomCount=null)
    bossMonsterId: [900 + overrides.id],
    monsterFamilyId: [800 + overrides.id],
    pictureUrl: `https://example.test/dungeon-${overrides.id}.png`,
    wakassetsAvailable: true,
    hasPreBossArchi: false,
    ...overrides,
  };
}

const DUNGEON_A = makeDungeon({ id: 1, type: 'THREE_ROOMS' });
const DUNGEON_B = makeDungeon({ id: 2, type: 'TWO_ROOMS' });
// Type FOUR_ROOMS : seule combinaison réelle avec hasPreBossArchi dans le référentiel actuel
// (Kokokolantha, Nécropoil de Morbax, La Pichine — voir dungeons_wakfu.json), pas un type à 1 seul
// combat comme dans une version antérieure de cette fixture.
const DUNGEON_ARCHI = makeDungeon({ id: 3, type: 'FOUR_ROOMS', hasPreBossArchi: true });
const DUNGEON_ONE_ROOM = makeDungeon({ id: 4, type: 'ULTIMATE_BOSS' });

function findDungeon(record: TestFight): CatalogDungeonEntry | null {
  if (record.bossOf === DUNGEON_A.id) return DUNGEON_A;
  if (record.bossOf === DUNGEON_B.id) return DUNGEON_B;
  if (record.bossOf === DUNGEON_ARCHI.id) return DUNGEON_ARCHI;
  if (record.bossOf === DUNGEON_ONE_ROOM.id) return DUNGEON_ONE_ROOM;
  return null;
}

function hasArchiEnemy(record: TestFight): boolean {
  return record.hasArchi === true;
}

// Par défaut, une clé UNIQUE par combat (dérivée de son id) : deux combats ne partagent la même
// composition que si le test le demande explicitement via `roomKey` — jamais de faux positif
// accidentel entre deux fixtures non liées.
function roomCompositionKey(record: TestFight): string {
  return record.roomKey ?? `unique:${record.id}`;
}

function group(records: TestFight[]) {
  return groupDungeonRuns(records, findDungeon, hasArchiEnemy, roomCompositionKey);
}

describe('groupDungeonRuns', () => {
  it('laisse un combat sans donjon reconnu en entrée single', () => {
    const records = [fight(1, 'Combat isolé', 'won', null)];
    expect(group(records)).toEqual([{ kind: 'single', record: records[0] }]);
  });

  it('laisse un boss gagné du premier coup sans salle rattachable en entrée single (type à 1 combat)', () => {
    const records = [fight(1, 'Boss ultime', 'won', DUNGEON_ONE_ROOM.id)];
    expect(group(records)).toEqual([{ kind: 'single', record: records[0] }]);
  });

  it('regroupe les salles précédentes avec le combat de boss (donjon 3 salles = 2 salles + boss)', () => {
    // Ordre plus récent -> plus ancien (comme mergedFights) : boss puis les 2 salles.
    const boss = fight(3, 'Boss A', 'won', DUNGEON_A.id);
    const room2 = fight(2, 'Salle 2', 'won', null);
    const room1 = fight(1, 'Salle 1', 'won', null);
    const records = [boss, room2, room1];

    const result = group(records);

    expect(result).toEqual([
      {
        kind: 'dungeonRun',
        dungeon: DUNGEON_A,
        fights: [boss, room2, room1], // plus récent -> plus ancien (dernier combat d'abord)
        representative: boss,
      },
    ]);
  });

  it("regroupe les tentatives de boss consécutives (défaites) jusqu'à la première victoire", () => {
    const win = fight(4, 'Boss A - victoire', 'won', DUNGEON_A.id);
    const lose2 = fight(3, 'Boss A - défaite 2', 'lost', DUNGEON_A.id);
    const lose1 = fight(2, 'Boss A - défaite 1', 'lost', DUNGEON_A.id);
    const room1 = fight(1, 'Salle 1', 'won', null);
    const records = [win, lose2, lose1, room1];

    const result = group(records);

    expect(result).toEqual([
      {
        kind: 'dungeonRun',
        dungeon: DUNGEON_A,
        fights: [win, lose2, lose1, room1],
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

    const result = group(records);

    // bossA reste seul (aucune salle rattachée, bossB appartient à un autre donjon) ; bossB+roomB
    // forment leur propre groupe (donjon B, TWO_ROOMS = 1 salle + boss).
    expect(result).toEqual([
      { kind: 'single', record: bossA },
      {
        kind: 'dungeonRun',
        dungeon: DUNGEON_B,
        fights: [bossB, roomB],
        representative: bossB,
      },
    ]);
  });

  it('ajoute une salle supplémentaire pour un donjon avec archimonstre pré-boss (hasPreBossArchi) détecté', () => {
    const boss = fight(2, 'Boss archi', 'won', DUNGEON_ARCHI.id);
    const archi = fight(1, 'Archimonstre pré-boss', 'won', null, { hasArchi: true });
    const records = [boss, archi];

    const result = group(records);

    expect(result).toEqual([
      {
        kind: 'dungeonRun',
        dungeon: DUNGEON_ARCHI,
        fights: [boss, archi],
        representative: boss,
      },
    ]);
  });

  it("n'ajoute PAS de créneau archimonstre si le combat qui précède le boss n'en contient pas (bug corrigé)", () => {
    // Kokokolantha (FOUR_ROOMS + hasPreBossArchi) : 3 salles normales + boss, AUCUNE d'entre elles
    // ne contient d'archimonstre cette fois-ci -> le regroupement doit rester à 4 combats (3 salles
    // + boss), pas 5, même si `hasPreBossArchi` vaut true pour ce donjon.
    const boss = fight(4, 'Boss Kokokolantha', 'won', DUNGEON_ARCHI.id);
    const room3 = fight(3, 'Salle 3', 'won', null);
    const room2 = fight(2, 'Salle 2', 'won', null);
    const room1 = fight(1, 'Salle 1', 'won', null);
    const records = [boss, room3, room2, room1];

    const result = group(records);

    expect(result).toEqual([
      {
        kind: 'dungeonRun',
        dungeon: DUNGEON_ARCHI,
        fights: [boss, room3, room2, room1],
        representative: boss,
      },
    ]);
  });

  it('archimonstre pré-boss + salles normales : 5 combats quand un des combats avant le boss en contient un', () => {
    const boss = fight(6, 'Boss Kokokolantha', 'won', DUNGEON_ARCHI.id);
    const archi = fight(5, 'Archimonstre pré-boss', 'won', null, { hasArchi: true });
    const room3 = fight(4, 'Salle 3', 'won', null);
    const room2 = fight(3, 'Salle 2', 'won', null);
    const room1 = fight(2, 'Salle 1', 'won', null);
    // Combat plus ancien encore, hors du run (roomSlots = 3 ne rattache que room3/room2/room1) —
    // vérifie que le ramassage s'arrête bien au bon nombre de salles même avec archimonstre détecté.
    const beforeRun = fight(1, 'Combat antérieur, hors run', 'won', null);
    const records = [boss, archi, room3, room2, room1, beforeRun];

    const result = group(records);

    // 1 (boss) + 1 (archi) + 3 (roomSlots = dungeonRoomCount(FOUR_ROOMS) - 1) = 5 combats.
    expect(result).toEqual([
      {
        kind: 'dungeonRun',
        dungeon: DUNGEON_ARCHI,
        fights: [boss, archi, room3, room2, room1],
        representative: boss,
      },
      { kind: 'single', record: beforeRun },
    ]);
  });

  it(
    "rattache TOUTES les défaites d'une salle retentée à cette salle, sans décaler la fenêtre " +
      "et perdre une salle plus ancienne (bug réel Kokokolantha, corrigé le 2026-08-26)',",
    () => {
      // Cas réel (donjon FOUR_ROOMS = 3 salles + boss, roomSlots = 3) : salle 3 gagnée du premier
      // coup, salle 2 perdue une fois puis regagnée, salle 1 gagnée du premier coup. Ça fait 4
      // combats de "salle" avant le boss (pas 3) — l'ancienne version comptait 3 COMBATS bruts
      // (room3, room2Lost, room2Win) et perdait room1, hors fenêtre.
      const boss = fight(5, 'Boss Kokokolantha', 'won', DUNGEON_ARCHI.id);
      const room3 = fight(4, 'Salle 3', 'won', null);
      const room2Win = fight(3, 'Salle 2 - victoire (retentée)', 'won', null, { roomKey: 'room2' });
      const room2Lost = fight(2, 'Salle 2 - défaite', 'lost', null, { roomKey: 'room2' });
      const room1 = fight(1, 'Salle 1', 'won', null);
      const records = [boss, room3, room2Win, room2Lost, room1];

      const result = group(records);

      expect(result).toEqual([
        {
          kind: 'dungeonRun',
          dungeon: DUNGEON_ARCHI,
          fights: [boss, room3, room2Win, room2Lost, room1],
          representative: boss,
        },
      ]);
    },
  );

  it(
    'rattache une défaite de la salle la plus ANCIENNE (dernier créneau) précédant sa propre ' +
      "victoire, MÊME composition d'ennemis (bug réel corrigé le 2026-08-30 : donjon TWO_ROOMS " +
      "réel où la boucle de ramassage s'arrêtait dès la victoire de salle sans regarder plus loin " +
      'en arrière, laissant la défaite orpheline hors du run malgré son adjacence immédiate)',
    () => {
      const boss = fight(3, 'Boss B', 'won', DUNGEON_B.id);
      const room1Win = fight(2, 'Salle 1 - victoire (retentée)', 'won', null, { roomKey: 'room1' });
      const room1Lost = fight(1, 'Salle 1 - défaite', 'lost', null, { roomKey: 'room1' });
      const records = [boss, room1Win, room1Lost];

      const result = group(records);

      expect(result).toEqual([
        {
          kind: 'dungeonRun',
          dungeon: DUNGEON_B,
          fights: [boss, room1Win, room1Lost],
          representative: boss,
        },
      ]);
    },
  );

  it(
    "NE rattache PAS une défaite dont la composition d'ennemis diffère de la victoire adjacente " +
      "(demande explicite de l'utilisateur, en remplacement d'un garde-fou par seuil de temps : " +
      'un vrai combat sans rapport ne doit jamais être avalé par le run, quelle que soit sa ' +
      'proximité temporelle avec la victoire de salle)',
    () => {
      const boss = fight(3, 'Boss B', 'won', DUNGEON_B.id);
      const room1Win = fight(2, 'Salle 1 - victoire', 'won', null, { roomKey: 'room1' });
      // Défaite immédiatement adjacente, mais contre une composition d'ennemis DIFFÉRENTE (roomKey
      // par défaut = unique) : un combat hors donjon sans rapport, jamais une tentative de salle 1.
      const unrelatedLoss = fight(1, 'Combat sans rapport (perdu)', 'lost', null);
      const records = [boss, room1Win, unrelatedLoss];

      const result = group(records);

      expect(result).toEqual([
        {
          kind: 'dungeonRun',
          dungeon: DUNGEON_B,
          fights: [boss, room1Win],
          representative: boss,
        },
        { kind: 'single', record: unrelatedLoss },
      ]);
    },
  );

  it(
    'ne rattache PAS une victoire antérieure (run précédent distinct) même adjacente à la salle ' +
      "la plus ancienne d'un run suivant",
    () => {
      // Le run précédent (boss B) se termine par une salle 1 GAGNÉE : une victoire ne doit jamais
      // être ramassée par le sweep de défaites (elle appartient déjà à un run antérieur distinct).
      const boss = fight(4, 'Boss B (run 2)', 'won', DUNGEON_B.id);
      const room1 = fight(3, 'Salle 1 (run 2)', 'won', null);
      const previousBoss = fight(2, 'Boss B (run 1, antérieur)', 'won', DUNGEON_B.id);
      const previousRoom1 = fight(1, 'Salle 1 (run 1, antérieur)', 'won', null);
      const records = [boss, room1, previousBoss, previousRoom1];

      const result = group(records);

      expect(result).toEqual([
        {
          kind: 'dungeonRun',
          dungeon: DUNGEON_B,
          fights: [boss, room1],
          representative: boss,
        },
        {
          kind: 'dungeonRun',
          dungeon: DUNGEON_B,
          fights: [previousBoss, previousRoom1],
          representative: previousBoss,
        },
      ]);
    },
  );

  it("s'arrête sans erreur si moins de salles que prévu sont disponibles (début de l'historique)", () => {
    // Donjon 3 salles (type THREE_ROOMS, 2 salles attendues) mais une seule salle disponible avant le
    // boss dans l'historique fourni (garde-fou : ne doit pas planter, ni sortir du tableau).
    const boss = fight(2, 'Boss A', 'won', DUNGEON_A.id);
    const room1 = fight(1, 'Seule salle disponible', 'won', null);
    const records = [boss, room1];

    const result = group(records);

    expect(result).toEqual([
      {
        kind: 'dungeonRun',
        dungeon: DUNGEON_A,
        fights: [boss, room1],
        representative: boss,
      },
    ]);
  });

  it('un donjon 1 salle (type à 1 combat) ne regroupe JAMAIS, même après des défaites répétées contre le même boss', () => {
    const win = fight(3, 'Boss 1 salle - victoire', 'won', DUNGEON_ONE_ROOM.id);
    const lose2 = fight(2, 'Boss 1 salle - défaite 2', 'lost', DUNGEON_ONE_ROOM.id);
    const lose1 = fight(1, 'Boss 1 salle - défaite 1', 'lost', DUNGEON_ONE_ROOM.id);
    const records = [win, lose2, lose1];

    const result = group(records);

    expect(result).toEqual([
      { kind: 'single', record: win },
      { kind: 'single', record: lose2 },
      { kind: 'single', record: lose1 },
    ]);
  });
});
