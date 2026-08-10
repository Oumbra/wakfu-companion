import { describe, expect, it } from 'vitest';
import { MAX_CLOCK_SKEW_MS, parsePatchBody, resolveWrites, type SettingWrite } from './merge';

const NOW = new Date('2026-08-10T12:00:00.000Z');

function write(key: string, updatedAt: string, value: unknown = { a: 1 }): SettingWrite {
  return { key: key as SettingWrite['key'], value, updatedAt: new Date(updatedAt) };
}

describe('parsePatchBody', () => {
  it('accepte un lot bien formé', () => {
    const result = parsePatchBody(
      {
        entries: [
          { key: 'profile', value: { pseudo: 'Oumbra' }, updatedAt: '2026-08-10T11:00:00.000Z' },
          { key: 'watchlist', value: [], updatedAt: '2026-08-10T11:30:00.000Z' },
        ],
      },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((w) => w.key)).toEqual(['profile', 'watchlist']);
    expect(result.value[0].updatedAt.toISOString()).toBe('2026-08-10T11:00:00.000Z');
  });

  it('accepte un lot vide (rien à envoyer)', () => {
    const result = parsePatchBody({ entries: [] }, NOW);
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('refuse une clé absente de la liste blanche', () => {
    const result = parsePatchBody(
      { entries: [{ key: 'sessionToken', value: 'x', updatedAt: NOW.toISOString() }] },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it('refuse une clé en double dans le même lot', () => {
    const result = parsePatchBody(
      {
        entries: [
          { key: 'profile', value: 1, updatedAt: '2026-08-10T11:00:00.000Z' },
          { key: 'profile', value: 2, updatedAt: '2026-08-10T11:30:00.000Z' },
        ],
      },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it('refuse une valeur absente (JSON n’a pas d’undefined : c’est une erreur de forme)', () => {
    const result = parsePatchBody(
      { entries: [{ key: 'profile', updatedAt: NOW.toISOString() }] },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it('refuse un updatedAt manquant ou illisible', () => {
    expect(parsePatchBody({ entries: [{ key: 'profile', value: 1 }] }, NOW).ok).toBe(false);
    expect(
      parsePatchBody({ entries: [{ key: 'profile', value: 1, updatedAt: 'hier' }] }, NOW).ok,
    ).toBe(false);
  });

  it('tolère une horloge légèrement en avance mais refuse une date lointaine', () => {
    const slightlyAhead = new Date(NOW.getTime() + 60_000).toISOString();
    const farFuture = new Date(NOW.getTime() + MAX_CLOCK_SKEW_MS + 60_000).toISOString();
    expect(
      parsePatchBody({ entries: [{ key: 'profile', value: 1, updatedAt: slightlyAhead }] }, NOW).ok,
    ).toBe(true);
    // Sans cette borne, une date très future rendrait la clé impossible à
    // écraser depuis un autre appareil.
    expect(
      parsePatchBody({ entries: [{ key: 'profile', value: 1, updatedAt: farFuture }] }, NOW).ok,
    ).toBe(false);
  });

  it('refuse un corps sans "entries"', () => {
    expect(parsePatchBody({}, NOW).ok).toBe(false);
    expect(parsePatchBody(null, NOW).ok).toBe(false);
    expect(parsePatchBody({ entries: {} }, NOW).ok).toBe(false);
  });
});

describe('resolveWrites', () => {
  it('accepte une écriture sur une clé encore absente du compte', () => {
    const { accepted, rejected } = resolveWrites(
      [write('profile', '2026-08-10T11:00:00.000Z')],
      new Map(),
    );
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it('accepte une écriture plus récente que celle du compte', () => {
    const remote = new Map([['profile', new Date('2026-08-10T10:00:00.000Z')]]);
    const { accepted, rejected } = resolveWrites(
      [write('profile', '2026-08-10T11:00:00.000Z')],
      remote,
    );
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it('refuse une écriture plus ancienne et renvoie la version conservée', () => {
    const remote = new Map([['profile', new Date('2026-08-10T11:00:00.000Z')]]);
    const { accepted, rejected } = resolveWrites(
      [write('profile', '2026-08-10T10:00:00.000Z')],
      remote,
    );
    expect(accepted).toHaveLength(0);
    expect(rejected).toEqual([{ key: 'profile', remoteUpdatedAt: '2026-08-10T11:00:00.000Z' }]);
  });

  it('refuse une écriture d’horodatage identique (déjà connue du serveur)', () => {
    const remote = new Map([['profile', new Date('2026-08-10T11:00:00.000Z')]]);
    const { accepted, rejected } = resolveWrites(
      [write('profile', '2026-08-10T11:00:00.000Z')],
      remote,
    );
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it('arbitre clé par clé, sans qu’un rejet n’en bloque une autre', () => {
    const remote = new Map([
      ['profile', new Date('2026-08-10T11:00:00.000Z')],
      ['roster', new Date('2026-08-10T09:00:00.000Z')],
    ]);
    const { accepted, rejected } = resolveWrites(
      [
        write('profile', '2026-08-10T10:00:00.000Z'),
        write('roster', '2026-08-10T10:00:00.000Z'),
        write('watchlist', '2026-08-10T10:00:00.000Z'),
      ],
      remote,
    );
    expect(accepted.map((w) => w.key)).toEqual(['roster', 'watchlist']);
    expect(rejected.map((r) => r.key)).toEqual(['profile']);
  });
});
