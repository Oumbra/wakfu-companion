import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogService } from './catalog.service';
import { ApiClientService, ApiResult } from './api-client.service';
import { PersistenceService } from '../services/persistence.service';

const ITEM_TUPLE = [
  1234,
  'Coiffe Test',
  'Test Headgear',
  'Tocado Test',
  'Chapéu Test',
  999,
  4,
  1,
  0,
];
const MONSTER_TUPLE = [42, 'Bouftou', 'Gobball', 'Jalató', 'Papatudo', '100200001', -1, 0, 0, 0];
const DUNGEON_ROW = {
  id: 7,
  fr: 'Donjon Test',
  en: 'Test Dungeon',
  es: 'Mazmorra Test',
  pt: 'Masmorra Teste',
  level: 20,
  bracket: 1,
  type: 'ULTIMATE_BOSS',
  bossMonsterId: 42,
  pictureUrl: 'https://static.ankama.com/dungeon.png',
  wakassetsAvailable: true,
  hasPreBossArchi: false,
};
const MONSTER_FAMILY_ROW = {
  id: 1,
  fr: 'Bouftous',
  en: 'Gobballs',
  es: 'Jalatós',
  pt: 'Papatudos',
};

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}
function offline<T>(): ApiResult<T> {
  return { ok: false, error: { kind: 'offline' } };
}

function setup(options: {
  cachedIndex?: unknown;
  cachedDungeons?: unknown;
  cachedMonsterFamilies?: unknown;
  version?: ApiResult<{ indexHash: string }>;
  index?: ApiResult<{ items: unknown[]; monsters: unknown[] }>;
  dungeons?: ApiResult<unknown[]>;
  monsterFamilies?: ApiResult<unknown[]>;
}) {
  const getCacheEntry = vi.fn(async (key: string) => {
    if (key === 'catalog-index') return options.cachedIndex;
    if (key === 'catalog-dungeons') return options.cachedDungeons;
    if (key === 'catalog-monster-families') return options.cachedMonsterFamilies;
    return undefined;
  });
  const setCacheEntry = vi.fn(async () => undefined);
  const getJson = vi.fn(async (path: string) => {
    if (path === '/catalog/version') return options.version ?? offline();
    if (path === '/catalog/') return options.index ?? offline();
    if (path === '/dungeons') return options.dungeons ?? offline();
    if (path === '/monster-families') return options.monsterFamilies ?? offline();
    throw new Error(`unexpected path in test: ${path}`);
  });

  TestBed.configureTestingModule({
    providers: [
      { provide: PersistenceService, useValue: { getCacheEntry, setCacheEntry } },
      { provide: ApiClientService, useValue: { getJson } },
    ],
  });

  return {
    service: TestBed.inject(CatalogService),
    getCacheEntry,
    setCacheEntry,
    getJson,
  };
}

describe('CatalogService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('sert le cache immédiatement (status ready) sans attendre le réseau si la version n’a pas changé', async () => {
    const cachedIndex = { indexHash: 'abc', items: [ITEM_TUPLE], monsters: [MONSTER_TUPLE] };
    const { service, getJson } = setup({
      cachedIndex,
      cachedDungeons: [DUNGEON_ROW],
      version: ok({ indexHash: 'abc' }),
    });

    await service.initialize();

    expect(service.status()).toBe('ready');
    expect(service.findWakfuItemEntry('Coiffe Test')?.id).toBe(1234);
    // Version vérifiée en arrière-plan, mais index PAS re-téléchargé (hash identique).
    expect(getJson).toHaveBeenCalledWith('/catalog/version');
    expect(getJson).not.toHaveBeenCalledWith('/catalog/');
  });

  it('rafraîchit quand même les donjons en arrière-plan si le hash (objets/monstres) n’a pas changé', async () => {
    // Bug réel corrigé : `indexHash` ne couvre pas les donjons (payload séparé). Une correction
    // portant UNIQUEMENT sur dungeons_wakfu.json (ex. type de donjon) ne doit pas rester invisible
    // indéfiniment pour un navigateur qui a déjà un catalogue en cache.
    const cachedIndex = { indexHash: 'abc', items: [ITEM_TUPLE], monsters: [MONSTER_TUPLE] };
    const staleDungeon = { ...DUNGEON_ROW, type: 'TWO_ROOMS' as const };
    const freshDungeon = { ...DUNGEON_ROW, type: 'ULTIMATE_BOSS' as const };
    const { service, getJson, setCacheEntry } = setup({
      cachedIndex,
      cachedDungeons: [staleDungeon],
      version: ok({ indexHash: 'abc' }),
      dungeons: ok([freshDungeon]),
    });

    await service.initialize();
    expect(service.findWakfuDungeonByBossMonsterId(42)?.type).toBe('TWO_ROOMS'); // état du cache, avant le rafraîchissement fire-and-forget

    // refreshDungeonsAndFamiliesOnly est lancé en fire-and-forget (void) : laisser les microtasks se dérouler.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(getJson).toHaveBeenCalledWith('/dungeons');
    expect(getJson).not.toHaveBeenCalledWith('/catalog/'); // toujours pas de re-téléchargement de l'index objets/monstres
    expect(service.findWakfuDungeonByBossMonsterId(42)?.type).toBe('ULTIMATE_BOSS');
    expect(setCacheEntry).toHaveBeenCalledWith('catalog-dungeons', [freshDungeon]);
  });

  it('rafraîchit quand même les familles de monstre en arrière-plan si le hash (objets/monstres) n’a pas changé', async () => {
    // Même bug/même correctif que pour les donjons ci-dessus : /monster-families est un payload
    // séparé, pas couvert par indexHash.
    const cachedIndex = { indexHash: 'abc', items: [ITEM_TUPLE], monsters: [MONSTER_TUPLE] };
    const { service, getJson, setCacheEntry } = setup({
      cachedIndex,
      cachedDungeons: [DUNGEON_ROW],
      cachedMonsterFamilies: [],
      version: ok({ indexHash: 'abc' }),
      monsterFamilies: ok([MONSTER_FAMILY_ROW]),
    });

    await service.initialize();
    expect(service.findWakfuMonsterFamilyById(1)).toBeUndefined(); // état du cache, avant le rafraîchissement fire-and-forget

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(getJson).toHaveBeenCalledWith('/monster-families');
    expect(service.findWakfuMonsterFamilyById(1)).toEqual(MONSTER_FAMILY_ROW);
    expect(setCacheEntry).toHaveBeenCalledWith('catalog-monster-families', [MONSTER_FAMILY_ROW]);
  });

  it('rafraîchit en arrière-plan si le hash serveur diffère du cache', async () => {
    const cachedIndex = { indexHash: 'old-hash', items: [], monsters: [] };
    const freshItemTuple = [
      5678,
      'Objet Neuf',
      'New Item',
      'Objeto Nuevo',
      'Item Novo',
      111,
      1,
      0,
      1,
    ];
    const { service, setCacheEntry } = setup({
      cachedIndex,
      cachedDungeons: [],
      version: ok({ indexHash: 'new-hash' }),
      index: ok({ items: [freshItemTuple], monsters: [] }),
      dungeons: ok([]),
    });

    await service.initialize();
    // refreshIfNeeded est lancé en fire-and-forget (void) : laisser les microtasks se dérouler.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.findWakfuItemEntry('Objet Neuf')?.id).toBe(5678);
    expect(setCacheEntry).toHaveBeenCalled();
  });

  it('attend le réseau au premier lancement (pas de cache) et passe ready en cas de succès', async () => {
    const { service } = setup({
      cachedIndex: undefined,
      cachedDungeons: undefined,
      version: ok({ indexHash: 'v1' }),
      index: ok({ items: [ITEM_TUPLE], monsters: [MONSTER_TUPLE] }),
      dungeons: ok([DUNGEON_ROW]),
      monsterFamilies: ok([MONSTER_FAMILY_ROW]),
    });

    await service.initialize();

    expect(service.status()).toBe('ready');
    expect(service.findWakfuItemEntryById(1234)?.fr).toBe('Coiffe Test');
    expect(service.findWakfuMonsterEntry('Gobball')?.id).toBe(42); // nom EN
    expect(service.findWakfuDungeonByBossMonsterId(42)?.id).toBe(7);
    expect(service.findWakfuMonsterFamilyById(1)).toEqual(MONSTER_FAMILY_ROW);
  });

  it('un échec réseau isolé sur /monster-families ne dégrade pas le reste du catalogue (status ready quand même)', async () => {
    const { service } = setup({
      cachedIndex: undefined,
      cachedDungeons: undefined,
      version: ok({ indexHash: 'v1' }),
      index: ok({ items: [ITEM_TUPLE], monsters: [MONSTER_TUPLE] }),
      dungeons: ok([DUNGEON_ROW]),
      monsterFamilies: offline(),
    });

    await service.initialize();

    expect(service.status()).toBe('ready');
    expect(service.findWakfuItemEntryById(1234)?.fr).toBe('Coiffe Test');
    expect(service.findWakfuMonsterFamilyById(1)).toBeUndefined();
  });

  it('passe "unavailable" si ni cache ni réseau ne sont exploitables', async () => {
    const { service } = setup({
      cachedIndex: undefined,
      cachedDungeons: undefined,
      version: offline(),
    });

    await service.initialize();

    expect(service.status()).toBe('unavailable');
    expect(service.findWakfuItemEntry('Coiffe Test')).toBeUndefined();
  });

  it('recherche un objet par nom quelle que soit sa langue (FR/EN/ES/PT)', async () => {
    const { service } = setup({
      cachedIndex: { indexHash: 'abc', items: [ITEM_TUPLE], monsters: [] },
      cachedDungeons: [],
      version: ok({ indexHash: 'abc' }),
    });

    await service.initialize();

    expect(service.findWakfuItemEntry('Test Headgear')?.id).toBe(1234);
    expect(service.findWakfuItemEntry('Tocado Test')?.id).toBe(1234);
    expect(service.findWakfuItemEntry('Chapéu Test')?.id).toBe(1234);
    expect(service.findWakfuItemEntry('Test Headgear')?.category).toBe('equipment');
  });

  it('getItemDetail/getMonsterDetail délèguent à ApiClientService et renvoient undefined en cas d’échec', async () => {
    const { service, getJson } = setup({});
    getJson.mockImplementation(async (path: string) => {
      if (path === '/items/1234') return ok({ id: 1234, recipe: [] });
      if (path === '/monsters/42') return offline();
      throw new Error(`unexpected path: ${path}`);
    });

    await expect(service.getItemDetail(1234)).resolves.toMatchObject({ id: 1234 });
    await expect(service.getMonsterDetail(42)).resolves.toBeUndefined();
  });
});
