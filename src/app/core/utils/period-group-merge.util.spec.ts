import { PeriodGroupTotals } from '../sync/history-stats.service';
import { mergeGroupTotals } from './period-group-merge.util';

function group(overrides: Partial<PeriodGroupTotals>): PeriodGroupTotals {
  return {
    fights: 0,
    dungeonRuns: 0,
    won: 0,
    lost: 0,
    kamasGained: 0,
    xpGained: 0,
    xpByCharacter: [],
    loot: [],
    ...overrides,
  };
}

describe('mergeGroupTotals', () => {
  it('renvoie un groupe à zéro pour une liste vide', () => {
    expect(mergeGroupTotals([])).toEqual(group({}));
  });

  it('somme les totaux plats de plusieurs groupes', () => {
    const merged = mergeGroupTotals([
      group({ fights: 3, dungeonRuns: 1, won: 2, lost: 1, kamasGained: 100, xpGained: 50 }),
      group({ fights: 2, dungeonRuns: 1, won: 0, lost: 2, kamasGained: 20, xpGained: 10 }),
    ]);
    expect(merged.fights).toBe(5);
    expect(merged.dungeonRuns).toBe(2);
    expect(merged.won).toBe(2);
    expect(merged.lost).toBe(3);
    expect(merged.kamasGained).toBe(120);
    expect(merged.xpGained).toBe(60);
  });

  it('fusionne xpByCharacter en sommant par nom', () => {
    const merged = mergeGroupTotals([
      group({ xpByCharacter: [{ name: 'Foo', amount: 10 }] }),
      group({
        xpByCharacter: [
          { name: 'Foo', amount: 5 },
          { name: 'Bar', amount: 3 },
        ],
      }),
    ]);
    expect(merged.xpByCharacter).toEqual(
      expect.arrayContaining([
        { name: 'Foo', amount: 15 },
        { name: 'Bar', amount: 3 },
      ]),
    );
    expect(merged.xpByCharacter).toHaveLength(2);
  });

  it('fusionne loot en sommant par itemId, et par itemName si itemId est null', () => {
    const merged = mergeGroupTotals([
      group({ loot: [{ itemId: 1, itemName: null, quantity: 2 }] }),
      group({ loot: [{ itemId: 1, itemName: null, quantity: 3 }] }),
      group({ loot: [{ itemId: null, itemName: 'Objet inconnu', quantity: 1 }] }),
      group({ loot: [{ itemId: null, itemName: 'Objet inconnu', quantity: 4 }] }),
    ]);
    expect(merged.loot).toEqual(
      expect.arrayContaining([
        { itemId: 1, itemName: null, quantity: 5 },
        { itemId: null, itemName: 'Objet inconnu', quantity: 5 },
      ]),
    );
    expect(merged.loot).toHaveLength(2);
  });
});
