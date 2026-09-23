import { describe, expect, it } from 'vitest';
import {
  MAX_CLOCK_SKEW_MS,
  MAX_SETTING_DEPTH,
  MAX_SETTING_VALUE_BYTES,
  jsonDepthExceeds,
  oversizedSettingError,
  parsePatchBody,
  parsePutBody,
  resolveWrites,
  settingValueBytes,
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

describe('updatedAt borné (audit 2026-09-23, #13)', () => {
  it('refuse une date antérieure à 2012, ou une chaîne de plus de 64 caractères', () => {
    const at = (updatedAt: string) =>
      parsePatchBody({ entries: [{ key: 'profile', value: 1, updatedAt }] }, NOW);
    expect(at('1970-01-01T00:00:00.000Z').ok).toBe(false);
    expect(at('2011-12-31T23:59:59.999Z').ok).toBe(false);
    expect(at(`2026-08-10T11:00:00.000Z${' '.repeat(60)}`).ok).toBe(false);
  });

  it('non-régression : formats réels acceptés (site : toISOString, overlay : to_rfc3339)', () => {
    for (const updatedAt of [
      '2026-08-10T11:00:00.000Z',
      '2026-08-10T11:00:00.123456789+00:00',
      '2026-08-10T13:00:00+02:00',
      '2012-01-01T00:00:00.000Z',
    ]) {
      const result = parsePatchBody({ entries: [{ key: 'profile', value: 1, updatedAt }] }, NOW);
      expect(result.ok, updatedAt).toBe(true);
    }
  });

  it('message d’erreur : jamais le corps brut (tronqué à 64 caractères)', () => {
    const huge = 'x'.repeat(100_000);
    for (const body of [
      { entries: [{ key: 'profile', value: 1, updatedAt: huge }] },
      { entries: [{ key: huge, value: 1, updatedAt: NOW.toISOString() }] },
    ]) {
      const result = parsePatchBody(body, NOW);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.length).toBeLessThan(120);
    }
    const put = parsePutBody({ data: { [huge]: 1 } });
    expect(put.ok).toBe(false);
    if (!put.ok) expect(put.error.length).toBeLessThan(120);
  });
});

describe('taille d’une valeur de configuration après fusion (audit 2026-09-23, #3)', () => {
  it('512 Kio par clé, mesurés en octets UTF-8 de la sérialisation JSON', () => {
    expect(MAX_SETTING_VALUE_BYTES).toBe(512 * 1024);
    expect(settingValueBytes({ a: 'é' })).toBe(new TextEncoder().encode('{"a":"é"}').length);
    expect(settingValueBytes('é'.repeat(10))).toBe(22);
  });

  it('refuse une valeur fusionnée au-delà de la borne, message borné', () => {
    const big = 'x'.repeat(MAX_SETTING_VALUE_BYTES);
    const error = oversizedSettingError('roster', [{ id: 'a', note: big }]);
    expect(error).toContain('roster');
    expect(error).toContain(String(MAX_SETTING_VALUE_BYTES));
    // Octets, pas unités UTF-16 : 300 000 « é » font 600 000 octets.
    expect(oversizedSettingError('profile', { pseudo: 'é'.repeat(300_000) })).not.toBeNull();
  });

  it('non-régression : tailles réelles (1 à 4 Ko, réattributions ~100 Ko) acceptées', () => {
    const profile = { pseudo: 'Oumbra', avatarIndex: 3, soundItems: Array(40).fill({ id: 1 }) };
    expect(oversizedSettingError('profile', profile)).toBeNull();
    const reassignments = Array.from({ length: 1500 }, (_, i) => ({
      spell: `Sort ${i}`,
      from: 'Anonyme-Iop1',
      to: 'Anonyme-Cra2',
      at: '2026-09-23T10:00:00.000Z',
    }));
    expect(settingValueBytes(reassignments)).toBeGreaterThan(100_000);
    expect(oversizedSettingError('damageReassignments', reassignments)).toBeNull();
  });
});
