import { describe, expect, it } from 'vitest';
import { ERASED_NAME_PLACEHOLDER, redactParticipants, redactPeerName } from './erased-names';

const p = (name: string, instanceIndex = 1, side: 'ally' | 'enemy' = 'ally') => ({
  name,
  instanceIndex,
  side,
  damage: 10,
});

describe('redactParticipants', () => {
  it('remplace un pseudonyme retiré, sans tenir compte de la casse, en gardant son indice', () => {
    const result = redactParticipants([p('Bob'), p('Alice')], new Set(['bob']));
    expect(result.map((r) => [r.name, r.instanceIndex])).toEqual([
      [ERASED_NAME_PLACEHOLDER, 1],
      ['Alice', 1],
    ]);
    expect(result[0].damage).toBe(10);
  });

  it('ne touche à rien sans pseudonyme retiré', () => {
    const rows = [p('Bob')];
    expect(redactParticipants(rows, new Set())).toEqual(rows);
  });

  it('évite une collision de clé entre deux tiers retirés, tous camps confondus', () => {
    const result = redactParticipants(
      [p('Bob'), p('Carl', 1, 'enemy'), p('Dan', 2)],
      new Set(['bob', 'carl']),
    );
    const keys = result.map((r) => `${r.name}#${r.instanceIndex}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(result[1]).toMatchObject({ name: ERASED_NAME_PLACEHOLDER, instanceIndex: 3 });
  });
});

describe('redactPeerName', () => {
  it('remplace seulement un nom retiré', () => {
    expect(redactPeerName('BOB', new Set(['bob']))).toBe(ERASED_NAME_PLACEHOLDER);
    expect(redactPeerName('Alice', new Set(['bob']))).toBe('Alice');
  });
});
