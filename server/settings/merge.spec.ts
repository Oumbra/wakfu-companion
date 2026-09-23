import { describe, expect, it } from 'vitest';
import {
  MAX_CLOCK_SKEW_MS,
  MAX_SETTING_DEPTH,
  jsonDepthExceeds,
  parsePatchBody,
  parsePutBody,
  resolveWrites,
  type SettingWrite,
} from './merge';

const NOW = new Date('2026-08-10T12:00:00.000Z');

function write(key: string, updatedAt: string, value: unknown = { a: 1 }): SettingWrite {
  return {
    key: key as SettingWrite['key'],
    mode: 'replace',
    value,
    updatedAt: new Date(updatedAt),
  };
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

  describe('écriture partielle (patch)', () => {
    it('accepte un correctif sur une clé fusionnable, typé en mode merge', () => {
      const result = parsePatchBody(
        {
          entries: [
            { key: 'profile', patch: { alertManualClose: true }, updatedAt: NOW.toISOString() },
            {
              key: 'roster',
              patch: { accounts: [{ id: 'a1', gameServer: 'pandora' }] },
              updatedAt: NOW.toISOString(),
            },
          ],
        },
        NOW,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.map((w) => w.mode)).toEqual(['merge', 'merge']);
      expect(result.value[0]).toMatchObject({
        key: 'profile',
        patch: { key: 'profile', fields: { alertManualClose: true } },
      });
    });

    it('garde le mode replace pour une valeur entière', () => {
      const result = parsePatchBody(
        { entries: [{ key: 'profile', value: { pseudo: 'x' }, updatedAt: NOW.toISOString() }] },
        NOW,
      );
      expect(result.ok && result.value[0].mode).toBe('replace');
    });

    it('refuse un correctif sur une clé non fusionnable', () => {
      const result = parsePatchBody(
        { entries: [{ key: 'watchlist', patch: { a: 1 }, updatedAt: NOW.toISOString() }] },
        NOW,
      );
      expect(result).toEqual({ ok: false, error: 'clé non fusionnable : watchlist' });
    });

    it('refuse "value" et "patch" sur la même entrée', () => {
      const result = parsePatchBody(
        { entries: [{ key: 'profile', value: {}, patch: { a: 1 }, updatedAt: NOW.toISOString() }] },
        NOW,
      );
      expect(result.ok).toBe(false);
    });

    it('refuse un correctif mal formé (remonte l’erreur de parseSettingPatch)', () => {
      const result = parsePatchBody(
        {
          entries: [
            { key: 'roster', patch: { accounts: [{ label: 'x' }] }, updatedAt: NOW.toISOString() },
          ],
        },
        NOW,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('compte sans "id"');
    });
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

describe('profondeur des valeurs (audit 2026-09-23)', () => {
  const nested = (depth: number): unknown => {
    let value: unknown = 1;
    for (let i = 0; i < depth; i++) value = [value];
    return value;
  };

  it('jsonDepthExceeds compte les niveaux d’objets/tableaux, sans récursion', () => {
    expect(jsonDepthExceeds(1)).toBe(false);
    expect(jsonDepthExceeds({ a: { b: [1] } }, 3)).toBe(false);
    expect(jsonDepthExceeds({ a: { b: [1] } }, 2)).toBe(true);
    expect(jsonDepthExceeds(nested(MAX_SETTING_DEPTH))).toBe(false);
    expect(jsonDepthExceeds(nested(MAX_SETTING_DEPTH + 1))).toBe(true);
    // Une imbrication extrême ne fait pas déborder la pile.
    expect(jsonDepthExceeds(nested(200_000))).toBe(true);
  });

  it('parsePatchBody refuse une valeur ou un correctif trop imbriqué', () => {
    const tooDeep = nested(MAX_SETTING_DEPTH + 1);
    const updatedAt = '2026-08-10T11:00:00.000Z';
    expect(
      parsePatchBody({ entries: [{ key: 'watchlist', value: tooDeep, updatedAt }] }, NOW).ok,
    ).toBe(false);
    expect(
      parsePatchBody({ entries: [{ key: 'profile', patch: { x: tooDeep }, updatedAt }] }, NOW).ok,
    ).toBe(false);
    expect(
      parsePatchBody({ entries: [{ key: 'watchlist', value: nested(5), updatedAt }] }, NOW).ok,
    ).toBe(true);
  });

  it('parsePutBody applique liste blanche et profondeur', () => {
    expect(parsePutBody({ data: { watchlist: [], profile: { a: 1 } } }).ok).toBe(true);
    expect(parsePutBody({ data: { inconnue: 1 } }).ok).toBe(false);
    expect(parsePutBody({ data: { watchlist: nested(MAX_SETTING_DEPTH + 1) } }).ok).toBe(false);
    expect(parsePutBody({ data: [] }).ok).toBe(false);
    expect(parsePutBody(null).ok).toBe(false);
  });
});
