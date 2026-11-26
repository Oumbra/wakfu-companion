import { describe, expect, it } from 'vitest';
import { CLASS_ICON_DATA_URI, CLASS_ICON_FEMALE_DATA_URI } from './class-icons.data';
import { CLASS_NAMES } from './class-names.data';
import {
  AVATAR_GRID_ENTRIES,
  CLASS_PORTRAIT_ORDER,
  CLASS_PORTRAITS_SPRITE_COLS,
  CLASS_PORTRAITS_SPRITE_ROWS,
  getAvatarGridEntry,
  getAvatarGridIndex,
} from './class-portraits.data';
import { WAKFU_CLASS_BREED_IDS } from './wakfu-class-breed-ids.data';

describe('tables de classes', () => {
  it('chaque classe jouable a une ligne de planche, un nom dans les 4 langues et ses deux icônes', () => {
    const classes = Object.values(WAKFU_CLASS_BREED_IDS);
    expect([...classes].sort()).toEqual([...CLASS_PORTRAIT_ORDER].sort());
    for (const key of classes) {
      expect(CLASS_NAMES[key], key).toBeDefined();
      for (const locale of ['fr', 'en', 'es', 'pt'] as const) {
        expect(CLASS_NAMES[key][locale], `${key}/${locale}`).toBeTruthy();
      }
      expect(CLASS_ICON_DATA_URI[key], key).toMatch(/^assets\/classes\/.+-m-[0-9a-f]{8}\.png$/);
      expect(CLASS_ICON_FEMALE_DATA_URI[key], key).toMatch(
        /^assets\/classes\/.+-f-[0-9a-f]{8}\.png$/,
      );
    }
  });

  it('la planche a une ligne par classe et la grille "Avatar" une case par classe et par sexe', () => {
    expect(CLASS_PORTRAITS_SPRITE_ROWS).toBe(CLASS_PORTRAIT_ORDER.length);
    expect(AVATAR_GRID_ENTRIES.length).toBe(
      CLASS_PORTRAITS_SPRITE_ROWS * CLASS_PORTRAITS_SPRITE_COLS,
    );
  });

  it('le Bellaphone (breed 20) occupe la dernière ligne, sans décaler les index déjà enregistrés', () => {
    expect(WAKFU_CLASS_BREED_IDS[20]).toBe('bellaphone');
    expect(getAvatarGridIndex('rogue', 'm')).toBe(35);
    expect(getAvatarGridIndex('bellaphone', 'f')).toBe(36);
    expect(getAvatarGridIndex('bellaphone', 'm')).toBe(37);
    expect(getAvatarGridEntry(37)).toEqual({ className: 'bellaphone', gender: 'm' });
  });
});
