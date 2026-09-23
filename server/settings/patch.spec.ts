import { describe, expect, it } from 'vitest';
import {
  MAX_ROSTER_PATCH_ACCOUNTS,
  applySettingPatch,
  isMergeableSettingKey,
  parseSettingPatch,
} from './patch';

describe('isMergeableSettingKey', () => {
  it('n’admet que profile et roster', () => {
    expect(isMergeableSettingKey('profile')).toBe(true);
    expect(isMergeableSettingKey('roster')).toBe(true);
    expect(isMergeableSettingKey('watchlist')).toBe(false);
    expect(isMergeableSettingKey('dashboardLayout')).toBe(false);
  });
});

describe('parseSettingPatch — profile', () => {
  it('accepte un objet de champs', () => {
    expect(parseSettingPatch('profile', { alertDurationSeconds: 2 })).toEqual({
      ok: true,
      value: { key: 'profile', fields: { alertDurationSeconds: 2 } },
    });
  });

  it('refuse un correctif vide, un tableau ou un scalaire', () => {
    expect(parseSettingPatch('profile', {}).ok).toBe(false);
    expect(parseSettingPatch('profile', []).ok).toBe(false);
    expect(parseSettingPatch('profile', 'x').ok).toBe(false);
    expect(parseSettingPatch('profile', null).ok).toBe(false);
  });
});

describe('parseSettingPatch — roster', () => {
  it('accepte des comptes identifiés et des identifiants à retirer', () => {
    const result = parseSettingPatch('roster', {
      accounts: [{ id: 'a1', characters: [] }],
      removedIds: ['a2'],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        key: 'roster',
        roster: { accounts: [{ id: 'a1', characters: [] }], removedIds: ['a2'] },
      },
    });
  });

  it('accepte l’une des deux listes seule', () => {
    expect(parseSettingPatch('roster', { removedIds: ['a2'] }).ok).toBe(true);
    expect(parseSettingPatch('roster', { accounts: [{ id: 'a1' }] }).ok).toBe(true);
  });

  it('refuse un correctif sans effet, un compte sans id, un doublon, un champ inconnu', () => {
    expect(parseSettingPatch('roster', {}).ok).toBe(false);
    expect(parseSettingPatch('roster', { accounts: [], removedIds: [] }).ok).toBe(false);
    expect(parseSettingPatch('roster', { accounts: [{ label: 'x' }] }).ok).toBe(false);
    expect(parseSettingPatch('roster', { accounts: [{ id: '' }] }).ok).toBe(false);
    expect(parseSettingPatch('roster', { accounts: [{ id: 'a' }, { id: 'a' }] }).ok).toBe(false);
    expect(parseSettingPatch('roster', { removedIds: [1] }).ok).toBe(false);
    expect(parseSettingPatch('roster', { accounts: 'x' }).ok).toBe(false);
    expect(parseSettingPatch('roster', { other: [] }).ok).toBe(false);
  });
});

describe('applySettingPatch — profile', () => {
  const stored = {
    pseudo: 'Oumbra',
    avatarIndex: 3,
    soundItems: [{ name: 'Pierre', enabled: true }],
    alertDurationSeconds: 3.5,
    alertManualClose: false,
  };

  it('ne remplace que les champs du correctif (le pseudo et l’avatar restent)', () => {
    const result = applySettingPatch(
      { key: 'profile', fields: { alertManualClose: true, alertDurationSeconds: 2 } },
      stored,
    );
    expect(result).toEqual({ ...stored, alertManualClose: true, alertDurationSeconds: 2 });
  });

  it('remplace une liste en bloc, sans fusion récursive', () => {
    const result = applySettingPatch({ key: 'profile', fields: { soundItems: [] } }, stored);
    expect(result).toEqual({ ...stored, soundItems: [] });
  });

  it('accepte null comme valeur de champ (ce n’est pas une suppression)', () => {
    const result = applySettingPatch({ key: 'profile', fields: { avatarIndex: null } }, stored);
    expect((result as { avatarIndex: unknown }).avatarIndex).toBeNull();
  });

  it('part d’un objet vide quand le compte n’a pas encore de profil ou une valeur inattendue', () => {
    const fields = { alertManualClose: true };
    expect(applySettingPatch({ key: 'profile', fields }, undefined)).toEqual(fields);
    expect(applySettingPatch({ key: 'profile', fields }, null)).toEqual(fields);
    expect(applySettingPatch({ key: 'profile', fields }, [1, 2])).toEqual(fields);
  });
});

describe('applySettingPatch — roster', () => {
  const stored = [
    { id: 'main', label: '', isDefault: true, characters: [{ name: 'A' }], futureField: 42 },
    { id: 'alt', label: 'Alt', characters: [] },
  ];

  it('fusionne un compte par id en gardant ses champs non cités (même inconnus)', () => {
    const result = applySettingPatch(
      {
        key: 'roster',
        roster: {
          accounts: [{ id: 'main', characters: [{ name: 'A' }, { name: 'B' }] }],
          removedIds: [],
        },
      },
      stored,
    );
    expect(result).toEqual([
      { ...stored[0], characters: [{ name: 'A' }, { name: 'B' }] },
      stored[1],
    ]);
  });

  it('ajoute un compte inconnu en fin de liste', () => {
    const result = applySettingPatch(
      {
        key: 'roster',
        roster: { accounts: [{ id: 'new', label: 'Nouveau', characters: [] }], removedIds: [] },
      },
      stored,
    );
    expect(result).toEqual([...stored, { id: 'new', label: 'Nouveau', characters: [] }]);
  });

  it('retire les comptes listés dans removedIds', () => {
    const result = applySettingPatch(
      { key: 'roster', roster: { accounts: [], removedIds: ['alt'] } },
      stored,
    );
    expect(result).toEqual([stored[0]]);
  });

  it('un id à la fois fusionné et retiré est retiré (la suppression l’emporte)', () => {
    const result = applySettingPatch(
      { key: 'roster', roster: { accounts: [{ id: 'alt', label: 'x' }], removedIds: ['alt'] } },
      stored,
    );
    expect(result).toEqual([stored[0]]);
  });

  it('ne touche pas aux autres comptes ni à leur ordre', () => {
    const result = applySettingPatch(
      {
        key: 'roster',
        roster: { accounts: [{ id: 'alt', gameServer: 'pandora' }], removedIds: [] },
      },
      stored,
    );
    expect(result).toEqual([stored[0], { ...stored[1], gameServer: 'pandora' }]);
  });

  it('part d’une liste vide quand le compte n’a pas encore de roster', () => {
    const result = applySettingPatch(
      { key: 'roster', roster: { accounts: [{ id: 'main', characters: [] }], removedIds: [] } },
      undefined,
    );
    expect(result).toEqual([{ id: 'main', characters: [] }]);
  });
});

describe('garde-fous du correctif (audit 2026-09-23)', () => {
  it('filtre __proto__/constructor/prototype d’un correctif de profil', () => {
    const raw = JSON.parse('{"__proto__": {"admin": true}, "constructor": 1, "pseudo": "Oumbra"}');
    const parsed = parseSettingPatch('profile', raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.key !== 'profile') return;
    expect(Object.keys(parsed.value.fields)).toEqual(['pseudo']);
    const merged = applySettingPatch(parsed.value, { pseudo: 'Ancien' }) as Record<string, unknown>;
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(merged, '__proto__')).toBe(false);
  });

  it('refuse un correctif de profil réduit à des clés interdites', () => {
    expect(parseSettingPatch('profile', JSON.parse('{"__proto__": 1}')).ok).toBe(false);
  });

  it('filtre les clés interdites des comptes du roster', () => {
    const raw = JSON.parse('{"accounts": [{"id": "a", "__proto__": {"x": 1}, "label": "A"}]}');
    const parsed = parseSettingPatch('roster', raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.key !== 'roster') return;
    expect(Object.keys(parsed.value.roster.accounts[0])).toEqual(['id', 'label']);
  });

  it(`borne le correctif roster à ${MAX_ROSTER_PATCH_ACCOUNTS} comptes`, () => {
    const accounts = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${i}` }));
    expect(parseSettingPatch('roster', { accounts: accounts(MAX_ROSTER_PATCH_ACCOUNTS) }).ok).toBe(
      true,
    );
    expect(
      parseSettingPatch('roster', { accounts: accounts(MAX_ROSTER_PATCH_ACCOUNTS + 1) }).ok,
    ).toBe(false);
    const removedIds = Array.from({ length: MAX_ROSTER_PATCH_ACCOUNTS + 1 }, (_, i) => `r${i}`);
    expect(parseSettingPatch('roster', { removedIds }).ok).toBe(false);
  });

  it('fusionne un gros roster stocké en conservant l’ordre et les comptes non cités', () => {
    const stored = Array.from({ length: 5000 }, (_, i) => ({ id: `id-${i}`, label: `L${i}` }));
    const parsed = parseSettingPatch('roster', {
      accounts: [
        { id: 'id-4999', label: 'fin' },
        { id: 'neuf', label: 'N' },
      ],
      removedIds: ['id-0'],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const merged = applySettingPatch(parsed.value, stored) as { id: string; label: string }[];
    expect(merged).toHaveLength(5000);
    expect(merged[0]).toEqual({ id: 'id-1', label: 'L1' });
    expect(merged[4998]).toEqual({ id: 'id-4999', label: 'fin' });
    expect(merged[4999]).toEqual({ id: 'neuf', label: 'N' });
  });
});
