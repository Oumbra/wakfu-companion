import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FIGHT_IMAGE_URL,
  resolveFightImageInfo,
  resolveFightImageUrl,
} from './fight-image.util';
import { CatalogService } from '../api/catalog.service';
import { ApiClientService, ApiResult } from '../api/api-client.service';
import { PersistenceService } from '../services/persistence.service';

function monsterPictureUrl(gfxId: string): string {
  return `https://static.ankama.com/wakfu/portal/game/monster/42/${gfxId}.png`;
}

// Tuple v3 (server/catalog/compact-index.ts) :
// [id, fr, en, es, pt, gfxId, family(-1 si null), isBoss(0|1), isArchi(0|1), isDominant(0|1)]
const BOSS_WITH_DUNGEON = [101, 'Boss Avec Donjon', 'en', 'es', 'pt', '900101', 1, 1, 0, 0];
const BOSS_WITHOUT_DUNGEON = [102, 'Boss Sans Donjon', 'en', 'es', 'pt', '900102', 1, 1, 0, 0];
const ARCHI = [103, 'Archi Test', 'en', 'es', 'pt', '900103', 2, 0, 1, 0];
const DOMINANT = [104, 'Dominant Test', 'en', 'es', 'pt', '900104', 3, 0, 0, 1];
// 5 familles distinctes, aucun boss/archi/dominant — pour le test "horde hétérogène".
const HORDE = [10, 11, 12, 13, 14].map((family, i) => [
  105 + i,
  `Horde ${i}`,
  'en',
  'es',
  'pt',
  `90020${i}`,
  family,
  0,
  0,
  0,
]);
const NORMAL_A = [110, 'Ennemi Normal A', 'en', 'es', 'pt', '900110', 20, 0, 0, 0];
const NORMAL_B = [111, 'Ennemi Normal B', 'en', 'es', 'pt', '900111', 21, 0, 0, 0];

const DUNGEON_FOR_BOSS = {
  id: 500,
  fr: 'Donjon Boss',
  en: 'Boss Dungeon',
  es: 'Mazmorra Boss',
  pt: 'Masmorra Chefe',
  level: 1,
  bracket: 1,
  type: 'ULTIMATE_BOSS',
  bossMonsterId: 101,
  pictureUrl: 'https://example.test/dungeon-500.png',
  wakassetsAvailable: true,
  hasPreBossArchi: false,
};

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

/** Construit un CatalogService réel (pas un mock) peuplé synchroniquement via initialize(),
 * comme catalog.service.spec.ts — ApiClientService/PersistenceService mockés pour fournir les
 * fixtures ci-dessus sans réseau ni IndexedDB. */
function setupCatalog(): CatalogService {
  const getCacheEntry = async () => undefined;
  const setCacheEntry = async () => undefined;
  const getJson = async (path: string) => {
    if (path === '/catalog/version') return ok({ indexHash: 'fixture' });
    if (path === '/catalog/') {
      return ok({
        items: [],
        monsters: [
          BOSS_WITH_DUNGEON,
          BOSS_WITHOUT_DUNGEON,
          ARCHI,
          DOMINANT,
          ...HORDE,
          NORMAL_A,
          NORMAL_B,
        ],
      });
    }
    if (path === '/dungeons') return ok([DUNGEON_FOR_BOSS]);
    throw new Error(`unexpected path in test: ${path}`);
  };

  TestBed.configureTestingModule({
    providers: [
      { provide: PersistenceService, useValue: { getCacheEntry, setCacheEntry } },
      { provide: ApiClientService, useValue: { getJson } },
    ],
  });
  return TestBed.inject(CatalogService);
}

describe('resolveFightImageUrl', () => {
  it('priorité 1 : boss présent -> illustration du donjon dont il est le boss (croisée via bossMonsterId)', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = resolveFightImageUrl(catalog, ['Ennemi Normal A', 'Boss Avec Donjon']);

    expect(result).toBe(DUNGEON_FOR_BOSS.pictureUrl);
    expect(result).not.toBe(monsterPictureUrl('900101'));
  });

  it('priorité 1 (repli) : boss sans donjon référencé pour son id -> sa propre illustration', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = resolveFightImageUrl(catalog, ['Ennemi Normal A', 'Boss Sans Donjon']);

    expect(result).toBe(monsterPictureUrl('900102'));
  });

  it('priorité 2 : plus de 4 familles distinctes parmi les ennemis (sans boss) -> illustration générique', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = resolveFightImageUrl(
      catalog,
      HORDE.map((m) => m[1] as string),
    );

    expect(result).toBe(DEFAULT_FIGHT_IMAGE_URL);
  });

  it('priorité 2 : 4 familles distinctes ou moins ne déclenche pas le repli générique', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = resolveFightImageUrl(
      catalog,
      HORDE.slice(0, 4).map((m) => m[1] as string),
    );

    expect(result).not.toBe(DEFAULT_FIGHT_IMAGE_URL);
  });

  it('priorité 3 : archimonstre présent (sans boss, sans horde) -> sa propre illustration', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = resolveFightImageUrl(catalog, ['Ennemi Normal A', 'Archi Test']);

    expect(result).toBe(monsterPictureUrl('900103'));
  });

  it('priorité 4 : dominant présent (sans boss/archi/horde) -> sa propre illustration', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = resolveFightImageUrl(catalog, ['Ennemi Normal A', 'Dominant Test']);

    expect(result).toBe(monsterPictureUrl('900104'));
  });

  it('priorité 5 : aucun cas particulier -> illustration du monstre ayant infligé le plus de dégâts (1er de la liste)', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = resolveFightImageUrl(catalog, ['Ennemi Normal A', 'Ennemi Normal B']);

    expect(result).toBe(monsterPictureUrl('900110'));
  });

  it('ignore les noms sans entrée catalogue connue', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = resolveFightImageUrl(catalog, [
      'Un Monstre Totalement Inconnu',
      'Ennemi Normal A',
    ]);

    expect(result).toBe(monsterPictureUrl('900110'));
  });

  it('retourne null quand aucun ennemi connu du catalogue', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = resolveFightImageUrl(catalog, ['Un Monstre Totalement Inconnu']);

    expect(result).toBeNull();
  });
});

describe('resolveFightImageInfo (tooltip)', () => {
  it('boss avec donjon référencé -> tooltipSource de type donjon (nom localisé du donjon)', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const info = resolveFightImageInfo(catalog, ['Ennemi Normal A', 'Boss Avec Donjon']);

    expect(info.tooltipSource).toEqual({ kind: 'dungeon', names: DUNGEON_FOR_BOSS });
  });

  it('boss sans donjon référencé -> tooltipSource de type monstre (le boss lui-même)', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const info = resolveFightImageInfo(catalog, ['Ennemi Normal A', 'Boss Sans Donjon']);

    expect(info.tooltipSource).toMatchObject({
      kind: 'monster',
      names: { fr: 'Boss Sans Donjon', en: 'en', es: 'es', pt: 'pt' },
    });
  });

  it('illustration générique (horde hétérogène) -> aucune tooltip', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const info = resolveFightImageInfo(
      catalog,
      HORDE.map((m) => m[1] as string),
    );

    expect(info.url).toBe(DEFAULT_FIGHT_IMAGE_URL);
    expect(info.tooltipSource).toBeNull();
  });

  it('aucun ennemi connu -> aucune tooltip', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const info = resolveFightImageInfo(catalog, ['Un Monstre Totalement Inconnu']);

    expect(info.tooltipSource).toBeNull();
  });
});
