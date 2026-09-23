import { describe, expect, it } from 'vitest';
import { planFightDedup, type FightDedupRow } from './dedupe-fights';

const U1 = '00000000-0000-0000-0000-000000000001';
const U2 = '00000000-0000-0000-0000-000000000002';
const AT = '2026-09-20T10:00:00.000Z';
const SEATS = 'Bouftou#1,Oumbra#1';

function row(overrides: Partial<FightDedupRow>): FightDedupRow {
  return {
    id: 1,
    userId: U1,
    startedAt: AT,
    durationMs: 42_000,
    fightLogId: 1680001273,
    seats: SEATS,
    ...overrides,
  };
}

describe('planFightDedup', () => {
  it('garde l’original (fight_log_id renseigné), efface les renvois d’archive à fight_log_id NULL', () => {
    const plan = planFightDedup([
      row({ id: 10 }),
      row({ id: 25, fightLogId: null }),
      row({ id: 31, fightLogId: null }),
    ]);
    expect(plan).toEqual([{ keepId: 10, deleteIds: [25, 31], latestDuplicateId: 31 }]);
  });

  it('tous à fight_log_id NULL : garde le plus ancien', () => {
    expect(
      planFightDedup([row({ id: 8, fightLogId: null }), row({ id: 3, fightLogId: null })]),
    ).toEqual([{ keepId: 3, deleteIds: [8], latestDuplicateId: 8 }]);
  });

  it('non-régression : n’efface jamais un combat issu du log, ni un combat sans doublon', () => {
    // Deux combats réels (fight_log_id renseignés) identiques en apparence : intouchés.
    expect(planFightDedup([row({ id: 1 }), row({ id: 2, fightLogId: 99 })])).toEqual([]);
    // Combat seul, même à fight_log_id NULL.
    expect(planFightDedup([row({ id: 1, fightLogId: null })])).toEqual([]);
  });

  it('ne groupe que sur compte, début, durée ET participants identiques', () => {
    const plan = planFightDedup([
      row({ id: 1 }),
      row({ id: 2, fightLogId: null, userId: U2 }),
      row({ id: 3, fightLogId: null, startedAt: '2026-09-20T10:00:01.000Z' }),
      row({ id: 4, fightLogId: null, durationMs: 41_000 }),
      row({ id: 5, fightLogId: null, seats: 'Bouftou#1,Bouftou#2,Oumbra#1' }),
      row({ id: 6, fightLogId: null, durationMs: null }),
    ]);
    expect(plan).toEqual([]);
  });

  it('durée NULL : les combats sans durée se groupent entre eux', () => {
    expect(
      planFightDedup([
        row({ id: 1, durationMs: null }),
        row({ id: 2, durationMs: null, fightLogId: null }),
      ]),
    ).toEqual([{ keepId: 1, deleteIds: [2], latestDuplicateId: 2 }]);
  });
});
