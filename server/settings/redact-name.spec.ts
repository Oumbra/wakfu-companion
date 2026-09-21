import { describe, expect, it } from 'vitest';
import { containsName, redactName } from './redact-name';

describe('containsName', () => {
  it('reconnaît le pseudonyme quelle que soit la casse ou les espaces de bord', () => {
    expect(containsName({ text: '  bob  ' }, 'Bob')).toBe(true);
    expect(containsName(['BOB'], 'bob')).toBe(true);
  });

  it('ne reconnaît jamais une sous-chaîne (« Bobby » n’est pas « Bob »)', () => {
    expect(containsName({ text: 'Bobby' }, 'Bob')).toBe(false);
    expect(containsName({ text: 'salut Bob' }, 'Bob')).toBe(false);
  });
});

describe('redactName', () => {
  it('retire le filtre de chat portant le pseudonyme et garde les autres', () => {
    const filters = [
      { text: 'bob', channel: 'global' },
      { text: 'recrutement', channel: 'guild' },
    ];
    const result = redactName(filters, 'Bob');
    expect(result.removed).toBe(1);
    expect(result.residual).toBe(0);
    expect(result.value).toEqual([{ text: 'recrutement', channel: 'guild' }]);
  });

  it('retire une correction d’attribution nommant le pseudonyme des deux côtés', () => {
    const reassignments = [
      {
        fightId: 1,
        spellName: 'Flamme',
        from: { name: 'Bob', instanceIndex: 1 },
        to: { name: 'Moi', instanceIndex: 1 },
      },
      {
        fightId: 2,
        spellName: 'Glace',
        from: { name: 'Moi', instanceIndex: 1 },
        to: { name: 'Bob', instanceIndex: 1 },
      },
      {
        fightId: 3,
        spellName: 'Vent',
        from: { name: 'Moi', instanceIndex: 1 },
        to: { name: 'Autre', instanceIndex: 1 },
      },
    ];
    const result = redactName(reassignments, 'Bob');
    expect(result.removed).toBe(2);
    expect(result.value).toEqual([reassignments[2]]);
  });

  it('descend dans les tableaux imbriqués sans toucher au reste', () => {
    const value = { accounts: [{ characters: [{ name: 'Bob' }, { name: 'Moi' }] }] };
    const result = redactName(value, 'Bob');
    expect(result.removed).toBe(1);
    expect(result.value).toEqual({ accounts: [{ characters: [{ name: 'Moi' }] }] });
  });

  it('compte en résiduel une occurrence qui n’est pas un élément de tableau, sans la réécrire', () => {
    const value = { pseudo: 'Bob', theme: 'dark' };
    const result = redactName(value, 'Bob');
    expect(result.removed).toBe(0);
    expect(result.residual).toBe(1);
    expect(result.value).toEqual(value);
  });

  it('rend la valeur d’origine, inchangée, quand le pseudonyme est absent', () => {
    const value = [{ text: 'hdv', channel: 'trade' }];
    const result = redactName(value, 'Bob');
    expect(result.value).toBe(value);
    expect(result.removed).toBe(0);
    expect(result.residual).toBe(0);
  });
});
