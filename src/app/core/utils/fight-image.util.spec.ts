import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FIGHT_IMAGE_URL,
  resolveFightImageInfo,
  resolveFightImageUrl,
} from './fight-image.util';
import { findWakfuMonsterEntry } from '../data/wakfu-monsters.data';
import { findWakfuDungeonByBossMonsterId } from '../data/wakfu-dungeons.data';

describe('resolveFightImageUrl', () => {
  it('priorité 1 : boss présent -> illustration du donjon dont il est le boss (croisée via bossMonsterId)', () => {
    const boss = findWakfuMonsterEntry('Magmog le Boufrog')!;
    expect(boss.isBoss).toBe(true);
    const dungeon = findWakfuDungeonByBossMonsterId(boss.id)!;
    expect(dungeon).toBeDefined();

    const result = resolveFightImageUrl(['Bouftou', 'Magmog le Boufrog']);

    expect(result).toBe(dungeon.pictureUrl);
    expect(result).not.toBe(boss.pictureUrl);
  });

  it('priorité 1 (repli) : boss sans donjon référencé pour son id -> sa propre picture_url', () => {
    const boss = findWakfuMonsterEntry('Lardevil')!;
    expect(boss.isBoss).toBe(true);
    expect(findWakfuDungeonByBossMonsterId(boss.id)).toBeUndefined();

    const result = resolveFightImageUrl(['Bouftou', 'Lardevil']);

    expect(result).toBe(boss.pictureUrl);
  });

  it('priorité 2 : plus de 4 familles distinctes parmi les ennemis (sans boss) -> illustration générique', () => {
    const result = resolveFightImageUrl([
      'Bouftou', // famille 1
      'Tofu', // famille 2
      'Piou Rouge', // famille 4
      'Pissenlit Diabolique', // famille 5
      'Larve Bleue', // famille 6
    ]);

    expect(result).toBe(DEFAULT_FIGHT_IMAGE_URL);
  });

  it('priorité 2 : 4 familles distinctes ou moins ne déclenche pas le repli générique', () => {
    const result = resolveFightImageUrl(['Bouftou', 'Tofu', 'Piou Rouge', 'Pissenlit Diabolique']);

    expect(result).not.toBe(DEFAULT_FIGHT_IMAGE_URL);
  });

  it('priorité 3 : archimonstre présent (sans boss, sans horde) -> sa picture_url', () => {
    const archi = findWakfuMonsterEntry('Truduk le Rondouillard')!;
    expect(archi.isArchi).toBe(true);

    const result = resolveFightImageUrl(['Bouftou', 'Truduk le Rondouillard']);

    expect(result).toBe(archi.pictureUrl);
  });

  it('priorité 4 : dominant présent (sans boss/archi/horde) -> sa picture_url', () => {
    const dominant = findWakfuMonsterEntry('Pichon Dominant')!;
    expect(dominant.isDominant).toBe(true);

    const result = resolveFightImageUrl(['Bouftou', 'Pichon Dominant']);

    expect(result).toBe(dominant.pictureUrl);
  });

  it('priorité 5 : aucun cas particulier -> picture_url du monstre ayant infligé le plus de dégâts (1er de la liste)', () => {
    const topDamage = findWakfuMonsterEntry('Bouftou')!;

    const result = resolveFightImageUrl(['Bouftou', 'Tofu']);

    expect(result).toBe(topDamage.pictureUrl);
  });

  it('ignore les noms sans entrée référentiel connue', () => {
    const result = resolveFightImageUrl(['Un Monstre Totalement Inconnu', 'Bouftou']);

    expect(result).toBe(findWakfuMonsterEntry('Bouftou')!.pictureUrl);
  });

  it('retourne null quand aucun ennemi connu du référentiel', () => {
    const result = resolveFightImageUrl(['Un Monstre Totalement Inconnu']);

    expect(result).toBeNull();
  });
});

describe('resolveFightImageInfo (tooltip)', () => {
  it('boss avec donjon référencé -> tooltipSource de type donjon (nom localisé du donjon)', () => {
    const boss = findWakfuMonsterEntry('Magmog le Boufrog')!;
    const dungeon = findWakfuDungeonByBossMonsterId(boss.id)!;

    const info = resolveFightImageInfo(['Bouftou', 'Magmog le Boufrog']);

    expect(info.tooltipSource).toEqual({ kind: 'dungeon', names: dungeon });
  });

  it('boss sans donjon référencé -> tooltipSource de type monstre (le boss lui-même)', () => {
    const boss = findWakfuMonsterEntry('Lardevil')!;

    const info = resolveFightImageInfo(['Bouftou', 'Lardevil']);

    expect(info.tooltipSource).toEqual({ kind: 'monster', names: boss });
  });

  it('illustration générique (horde hétérogène) -> aucune tooltip', () => {
    const info = resolveFightImageInfo([
      'Bouftou',
      'Tofu',
      'Piou Rouge',
      'Pissenlit Diabolique',
      'Larve Bleue',
    ]);

    expect(info.url).toBe(DEFAULT_FIGHT_IMAGE_URL);
    expect(info.tooltipSource).toBeNull();
  });

  it('aucun ennemi connu -> aucune tooltip', () => {
    const info = resolveFightImageInfo(['Un Monstre Totalement Inconnu']);

    expect(info.tooltipSource).toBeNull();
  });
});
