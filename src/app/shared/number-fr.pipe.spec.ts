import { NumberFrPipe } from './number-fr.pipe';

describe('NumberFrPipe', () => {
  const pipe = new NumberFrPipe();

  // `toLocaleString('fr-FR')` sépare les milliers par une espace fine insécable (U+202F), pas une
  // espace normale — visuellement identique, mais un `' '` littéral dans un test échouerait.
  const NBSP = ' ';

  it('formate un nombre avec séparateur de milliers à la française', () => {
    expect(pipe.transform(1636978482)).toBe(`1${NBSP}636${NBSP}978${NBSP}482`);
  });

  it('formate une chaîne numérique de la même façon qu’un number', () => {
    // Cas réel : une agrégation SQL (sum/count) renvoyée par le driver Postgres en chaîne (voir
    // functions/api/v1/history/stats.ts) — sans coercition, `"1636978482".toLocaleString('fr-FR')`
    // retombe sur Object.prototype.toLocaleString et renvoie la chaîne brute non séparée.
    expect(pipe.transform('1636978482')).toBe(`1${NBSP}636${NBSP}978${NBSP}482`);
  });

  it('renvoie "0" pour null/undefined/valeur non numérique', () => {
    expect(pipe.transform(null)).toBe('0');
    expect(pipe.transform(undefined)).toBe('0');
    expect(pipe.transform('abc')).toBe('0');
  });

  it('formate zéro et les petits nombres sans séparateur', () => {
    expect(pipe.transform(0)).toBe('0');
    expect(pipe.transform(42)).toBe('42');
  });
});
