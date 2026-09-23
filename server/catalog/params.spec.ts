import { describe, expect, it } from 'vitest';
import { escapeLikePattern, parseAnkamaId, parseSearchQuery } from './params';

describe('parseAnkamaId', () => {
  it('accepte un entier positif jusqu’à PG_INT32_MAX', () => {
    expect(parseAnkamaId('1')).toBe(1);
    expect(parseAnkamaId('27340')).toBe(27340);
    expect(parseAnkamaId('2147483647')).toBe(2_147_483_647);
  });

  it('refuse zéro, négatif, décimal, notation exotique et dépassement integer', () => {
    for (const raw of [
      '0',
      '-5',
      '1.5',
      '1e3',
      '0x10',
      ' 12',
      '012',
      '2147483648',
      '99999999999',
      '',
    ]) {
      expect(parseAnkamaId(raw), raw).toBeNull();
    }
    expect(parseAnkamaId(undefined)).toBeNull();
    expect(parseAnkamaId(['1'])).toBeNull();
  });
});

describe('escapeLikePattern / parseSearchQuery', () => {
  it('échappe \\, % et _', () => {
    expect(escapeLikePattern('100%_\\x')).toBe('100\\%\\_\\\\x');
    expect(escapeLikePattern('Bouftou royal')).toBe('Bouftou royal');
  });

  it('construit un motif de sous-chaîne échappé', () => {
    expect(parseSearchQuery('  bou  ')).toEqual({ ok: true, pattern: '%bou%' });
    expect(parseSearchQuery('%%')).toEqual({ ok: true, pattern: '%\\%\\%%' });
  });

  it('refuse q absent, trop court ou trop long', () => {
    expect(parseSearchQuery(null).ok).toBe(false);
    expect(parseSearchQuery('a').ok).toBe(false);
    expect(parseSearchQuery('   ').ok).toBe(false);
    expect(parseSearchQuery('x'.repeat(64)).ok).toBe(true);
    expect(parseSearchQuery('x'.repeat(65)).ok).toBe(false);
  });
});
