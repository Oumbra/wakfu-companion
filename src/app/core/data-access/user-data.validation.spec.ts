import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAllowedAvatarExternalUrl, sanitizeUserDataValue } from './user-data.validation';
import { USER_DATA_KEY_LIST } from './user-data.keys';

const realExport = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/wakfu-companion-export.json'), 'utf-8'),
) as unknown;

describe('sanitizeUserDataValue — gardes de type des données utilisateur', () => {
  it("laisse intact un export réel de l'application", () => {
    const data = (realExport as { data: Record<string, unknown> }).data;
    for (const key of USER_DATA_KEY_LIST) {
      if (data[key] === undefined) continue;
      expect(sanitizeUserDataValue(key, data[key])).toEqual(data[key]);
    }
  });

  it('renvoie undefined pour une valeur de premier niveau du mauvais type', () => {
    expect(sanitizeUserDataValue('roster', 42)).toBeUndefined();
    expect(sanitizeUserDataValue('watchlist', { name: 'x' })).toBeUndefined();
    expect(sanitizeUserDataValue('profile', 'x')).toBeUndefined();
    expect(sanitizeUserDataValue('combatPanelCollapsed', 'true')).toBeUndefined();
    expect(sanitizeUserDataValue('watchlistAddMode', 'boom')).toBeUndefined();
    expect(sanitizeUserDataValue('chatFilters', null)).toBeUndefined();
  });

  it('écarte uniquement les éléments invalides d’une liste', () => {
    const watchlist = [
      { name: 'Poudre', count: 3, kind: 'item', mode: 'up', countdownTarget: 0, catalogId: null },
      { name: 'Bouftou', count: '3', kind: 'enemy' },
      null,
    ];
    expect(sanitizeUserDataValue('watchlist', watchlist)).toEqual([watchlist[0]]);
    const roster = [
      { id: 'a', label: 'A', characters: [{ name: 'X', className: 'cra', gender: 'm' }, 7] },
      { id: 3, label: 'B', characters: [] },
    ];
    expect(sanitizeUserDataValue('roster', roster)).toEqual([
      { id: 'a', label: 'A', characters: [{ name: 'X', className: 'cra', gender: 'm' }] },
    ]);
  });

  it('retire les champs invalides du profil, dont une URL d’avatar hors galeries fan-art', () => {
    const profile = sanitizeUserDataValue('profile', {
      pseudo: 'Moi',
      avatarExternalUrl: 'https://tracker.example/pixel.png',
      soundItems: 'x',
      alertDurationSeconds: 'NaN',
      characterViewMode: 'grid',
    });
    expect(profile).toEqual({ pseudo: 'Moi', characterViewMode: 'grid' });
  });

  it("n'accepte que les URL des galeries fan-art connues", () => {
    expect(isAllowedAvatarExternalUrl('https://static.ankama.com/web-test/1101.png')).toBe(true);
    expect(isAllowedAvatarExternalUrl('https://static.ankama.com/web-test/1.png')).toBe(false);
    expect(isAllowedAvatarExternalUrl('http://static.ankama.com/web-test/1101.png')).toBe(false);
    expect(isAllowedAvatarExternalUrl('javascript:alert(1)')).toBe(false);
  });

  it('dashboardLayout : retire un champ scalaire inconnu sans jeter le reste de la disposition', () => {
    const value = {
      menuPos: 'right',
      kpiPos: 'nulle-part',
      bodyMode: 'focus',
      focusTarget: 'combat',
      focusSide: 'left',
      historyGroup: { combats: true },
    };
    expect(sanitizeUserDataValue('dashboardLayout', value)).toEqual({
      menuPos: 'right',
      bodyMode: 'focus',
      focusSide: 'left',
      historyGroup: { combats: true },
    });
    expect(sanitizeUserDataValue('dashboardLayout', { focusTarget: 'recap' })).toEqual({
      focusTarget: 'recap',
    });
    expect(sanitizeUserDataValue('dashboardLayout', { menuPos: 'hasOwnProperty' })).toEqual({});
  });
});
