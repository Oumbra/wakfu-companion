import { describe, expect, it } from 'vitest';
import { parseStatsQuery } from './stats-query';

function query(overrides: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    since: '2026-08-01T00:00:00.000Z',
    until: '2026-08-31T00:00:00.000Z',
    ...overrides,
  });
}

describe('parseStatsQuery', () => {
  it('accepte une plage valide', () => {
    const result = parseStatsQuery(query());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.since.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(result.value.until.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('refuse since manquant', () => {
    const params = query();
    params.delete('since');
    const result = parseStatsQuery(params);
    expect(result.ok).toBe(false);
  });

  it('refuse until manquant', () => {
    const params = query();
    params.delete('until');
    const result = parseStatsQuery(params);
    expect(result.ok).toBe(false);
  });

  it('refuse since invalide', () => {
    const result = parseStatsQuery(query({ since: 'pas-une-date' }));
    expect(result.ok).toBe(false);
  });

  it('refuse until invalide', () => {
    const result = parseStatsQuery(query({ until: 'pas-une-date' }));
    expect(result.ok).toBe(false);
  });

  it('refuse until antérieur ou égal à since', () => {
    const equal = parseStatsQuery(
      query({ since: '2026-08-01T00:00:00.000Z', until: '2026-08-01T00:00:00.000Z' }),
    );
    expect(equal.ok).toBe(false);

    const before = parseStatsQuery(
      query({ since: '2026-08-31T00:00:00.000Z', until: '2026-08-01T00:00:00.000Z' }),
    );
    expect(before.ok).toBe(false);
  });

  it('refuse une plage de plus de 400 jours', () => {
    const result = parseStatsQuery(
      query({ since: '2024-01-01T00:00:00.000Z', until: '2026-08-01T00:00:00.000Z' }),
    );
    expect(result.ok).toBe(false);
  });

  it("accepte une plage d'environ une année civile", () => {
    const result = parseStatsQuery(
      query({ since: '2026-01-01T00:00:00.000Z', until: '2027-01-01T00:00:00.000Z' }),
    );
    expect(result.ok).toBe(true);
  });
});
