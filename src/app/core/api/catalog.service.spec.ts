import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogService } from './catalog.service';
import { ApiClientService, ApiResult } from './api-client.service';
import { PersistenceService } from '../services/persistence.service';

const ITEM_TUPLE = [1234, 'Coiffe Test', 'Test Headgear', 'Tocado Test', 'Chapéu Test', 999, 4, 1];
const MONSTER_TUPLE = [42, 'Bouftou', 'Gobball', 'Jalató', 'Papatudo', '100200001'];
const DUNGEON_ROW = {
  id: 7,
  fr: 'Donjon Test',
  en: 'Test Dungeon',
  es: 'Mazmorra Test',
  pt: 'Masmorra Teste',
  level: 20,
  tranche: 1,
  isBreach: false,
  isUltimateBreach: false,
  bossMonsterId: 42,
  pictureUrl: 'https://static.ankama.com/dungeon.png',
  wakassetsAvailable: true,
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
  version?: ApiResult<{ indexHash: string }>;
  index?: ApiResult<{ items: unknown[]; monsters: unknown[] }>;
  dungeons?: ApiResult<unknown[]>;
}) {
  const getCacheEntry = vi.fn(async (key: string) => {
    if (key === 'catalog-index') return options.cachedIndex;
    if (key === 'catalog-dungeons') return options.cachedDungeons;
    return undefined;
  });
  const setCacheEntry = vi.fn(async () => undefined);
  const getJson = vi.fn(async (path: string) => {
    if (path === '/catalog/version') return options.version ?? offline();
    if (path === '/catalog/index') return options.index ?? offline();
    if (path === '/dungeons') return options.dungeons ?? offline();
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
    expect(getJson).not.toHaveBeenCalledWith('/catalog/index');
  });

  it('rafraîchit en arrière-plan si le hash serveur diffère du cache', async () => {
    const cachedIndex = { indexHash: 'old-hash', items: [], monsters: [] };
    const freshItemTuple = [5678, 'Objet Neuf', 'New Item', 'Objeto Nuevo', 'Item Novo', 111, 1, 0];
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
    });

    await service.initialize();

    expect(service.status()).toBe('ready');
    expect(service.findWakfuItemEntryById(1234)?.fr).toBe('Coiffe Test');
    expect(service.findWakfuMonsterEntry('Gobball')?.id).toBe(42); // nom EN
    expect(service.findWakfuDungeonByBossMonsterId(42)?.id).toBe(7);
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
