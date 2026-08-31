import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FIGHT_IMAGE_URL,
  findDungeonForEnemies,
  resolveFightImageInfo,
  resolveFightImageUrl,
  resolveFightTypeClassification,
} from './fight-image.util';
import { BREACH_IMAGE_URL, ULTIMATE_BREACH_IMAGE_URL } from '../data/breach-icon.data';
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
// Second boss, utilisé uniquement pour le cas "plusieurs boss simultanés -> brèche ultime".
const BOSS_SECOND = [116, 'Boss Second', 'en', 'es', 'pt', '900116', 1, 1, 0, 0];
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
// Même famille (20) que NORMAL_A mais nom distinct — sert à vérifier que resolveFightTypeClassification
// regroupe bien par famille plutôt que par nom (voir describe ci-dessous).
const NORMAL_A_VARIANT = [112, 'Ennemi Normal A Variant', 'en', 'es', 'pt', '900112', 20, 0, 0, 0];
// Deux monstres SANS famille encyclopédie (family: null, comme 28 monstres du référentiel réel) —
// doivent former deux groupes DISTINCTS (repli par nom, un seul membre chacun).
const NO_FAMILY_A = [113, 'Sans Famille A', 'en', 'es', 'pt', '900113', -1, 0, 0, 0];
const NO_FAMILY_B = [114, 'Sans Famille B', 'en', 'es', 'pt', '900114', -1, 0, 0, 0];
const BOSS_OF_BREACH = [115, 'Boss De Brèche', 'en', 'es', 'pt', '900115', 30, 1, 0, 0];
// 5 familles distinctes (50-54), destinées à matcher exactement BREACH_MATCH_DUNGEON ci-dessous —
// sert à vérifier l'identification précise de LA brèche (pas seulement l'heuristique de détection).
const HORDE_MATCH = [50, 51, 52, 53, 54].map((family, i) => [
  120 + i,
  `Horde Match ${i}`,
  'en',
  'es',
  'pt',
  `90030${i}`,
  family,
  0,
  0,
  0,
]);
// Deux boss destinés à matcher exactement ULTIMATE_BREACH_MATCH_DUNGEON ci-dessous.
const BOSS_ULTIMATE_MATCH_A = [117, 'Boss Ultime Match A', 'en', 'es', 'pt', '900117', 40, 1, 0, 0];
const BOSS_ULTIMATE_MATCH_B = [118, 'Boss Ultime Match B', 'en', 'es', 'pt', '900118', 41, 1, 0, 0];
// Boss PARTAGÉ entre un donjon classique (DUNGEON_FOR_SHARED_BOSS) ET une brèche ultime
// (ULTIMATE_BREACH_SHARED_BOSS_DUNGEON) — reproduit le cas réel corrigé le 2026-08-28 ("Phacochemar",
// boss de "Donjon Vandaliénés" ET l'un des 8 boss de la "Brèche dimensionnelle ultime de la
// Shukrute" — voir CLAUDE.md). Seul, ce boss doit résoudre vers son donjon classique ; accompagné de
// son partenaire (SHARED_PARTNER, présent uniquement dans la brèche ultime), vers la brèche ultime.
const BOSS_SHARED = [125, 'Boss Partagé', 'en', 'es', 'pt', '900125', 45, 1, 0, 0];
const BOSS_SHARED_PARTNER = [
  126,
  'Boss Partagé Partenaire',
  'en',
  'es',
  'pt',
  '900126',
  46,
  1,
  0,
  0,
];

const DUNGEON_FOR_BOSS = {
  id: 500,
  fr: 'Donjon Boss',
  en: 'Boss Dungeon',
  es: 'Mazmorra Boss',
  pt: 'Masmorra Chefe',
  level: 1,
  bracket: 1,
  type: 'ULTIMATE_BOSS',
  bossMonsterId: [101],
  monsterFamilyId: [20],
  pictureUrl: 'https://example.test/dungeon-500.png',
  wakassetsAvailable: true,
  hasPreBossArchi: false,
};
const BREACH_DUNGEON = {
  id: 501,
  fr: 'Brèche Test',
  en: 'Breach Test',
  es: 'Brecha Test',
  pt: 'Brecha Teste',
  level: 1,
  bracket: 1,
  type: 'BREACH',
  bossMonsterId: [115],
  monsterFamilyId: [30],
  pictureUrl: 'https://example.test/dungeon-501.png',
  wakassetsAvailable: true,
  hasPreBossArchi: false,
};
// Composition volontairement en SUPERSET (famille 55 en plus, jamais présente dans HORDE_MATCH) :
// vérifie que le matching n'exige pas une égalité stricte, juste que les familles OBSERVÉES soient
// toutes couvertes — voir CatalogService.findWakfuBreachByMonsterFamilies.
const BREACH_MATCH_DUNGEON = {
  id: 502,
  fr: 'Brèche Correspondante',
  en: 'Matching Breach',
  es: 'Brecha Correspondiente',
  pt: 'Brecha Correspondente',
  level: 1,
  bracket: 1,
  type: 'BREACH',
  bossMonsterId: [],
  monsterFamilyId: [50, 51, 52, 53, 54, 55],
  pictureUrl: 'https://example.test/dungeon-502.png',
  wakassetsAvailable: true,
  hasPreBossArchi: false,
};
// Même principe en SUPERSET pour les boss (id 119 en plus, jamais présent dans le combat testé).
const ULTIMATE_BREACH_MATCH_DUNGEON = {
  id: 503,
  fr: 'Brèche Ultime Correspondante',
  en: 'Matching Ultimate Breach',
  es: 'Brecha Definitiva Correspondiente',
  pt: 'Brecha Suprema Correspondente',
  level: 1,
  bracket: 1,
  type: 'ULTIMATE_BREACH',
  bossMonsterId: [117, 118, 119],
  monsterFamilyId: [],
  pictureUrl: 'https://example.test/dungeon-503.png',
  wakassetsAvailable: true,
  hasPreBossArchi: false,
};
// Donjon classique du boss PARTAGÉ (voir BOSS_SHARED ci-dessus).
const DUNGEON_FOR_SHARED_BOSS = {
  id: 504,
  fr: 'Donjon Boss Partagé',
  en: 'Shared Boss Dungeon',
  es: 'Mazmorra Boss Compartido',
  pt: 'Masmorra Chefe Compartilhado',
  level: 1,
  bracket: 1,
  type: 'TWO_ROOMS',
  bossMonsterId: [125],
  monsterFamilyId: [45],
  pictureUrl: 'https://example.test/dungeon-504.png',
  wakassetsAvailable: true,
  hasPreBossArchi: false,
};
// Brèche ultime qui réunit LE MÊME boss (125) que DUNGEON_FOR_SHARED_BOSS, plus un 2e boss qui n'a
// lui aucun donjon classique — reproduit le cas réel du 2026-08-28 (voir BOSS_SHARED).
const ULTIMATE_BREACH_SHARED_BOSS_DUNGEON = {
  id: 505,
  fr: 'Brèche Ultime Partagée',
  en: 'Shared Ultimate Breach',
  es: 'Brecha Definitiva Compartida',
  pt: 'Brecha Suprema Compartilhada',
  level: 1,
  bracket: 1,
  type: 'ULTIMATE_BREACH',
  bossMonsterId: [125, 126],
  monsterFamilyId: [],
  pictureUrl: 'https://example.test/dungeon-505.png',
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
          BOSS_SECOND,
          ARCHI,
          DOMINANT,
          ...HORDE,
          NORMAL_A,
          NORMAL_B,
          NORMAL_A_VARIANT,
          NO_FAMILY_A,
          NO_FAMILY_B,
          BOSS_OF_BREACH,
          ...HORDE_MATCH,
          BOSS_ULTIMATE_MATCH_A,
          BOSS_ULTIMATE_MATCH_B,
          BOSS_SHARED,
          BOSS_SHARED_PARTNER,
        ],
      });
    }
    if (path === '/dungeons')
      return ok([
        DUNGEON_FOR_BOSS,
        BREACH_DUNGEON,
        BREACH_MATCH_DUNGEON,
        ULTIMATE_BREACH_MATCH_DUNGEON,
        DUNGEON_FOR_SHARED_BOSS,
        ULTIMATE_BREACH_SHARED_BOSS_DUNGEON,
      ]);
    if (path === '/monster-families') return ok([]);
    if (path === '/monster-loot') return ok([]);
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
  it("priorité 0 : PLUSIEURS boss simultanés D'IDS DISTINCTS correspondant à une brèche ultime connue -> illustration de brèche ultime (avant toute logique de donjon)", async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = resolveFightImageUrl(catalog, ['Boss Ultime Match A', 'Boss Ultime Match B']);

    expect(result).toBe(ULTIMATE_BREACH_IMAGE_URL);
  });

  it("priorité 0 (repli) : PLUSIEURS boss d'ids distincts mais ne correspondant à AUCUNE brèche ultime connue -> ne déclenche PAS la brèche ultime, retombe sur le 1er boss (référentiel des brèches ultimes exhaustif, pas de repli générique)", async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = resolveFightImageUrl(catalog, ['Boss Avec Donjon', 'Boss Second']);

    expect(result).not.toBe(ULTIMATE_BREACH_IMAGE_URL);
    expect(result).toBe(DUNGEON_FOR_BOSS.pictureUrl);
  });

  it('priorité 0 (repli) : le MÊME boss présent plusieurs fois (ex. resynchronisation en cours de combat réémettant sa jointure sous un nouveau fighterId) ne compte jamais comme plusieurs boss distincts', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = resolveFightImageUrl(catalog, ['Boss Avec Donjon', 'Boss Avec Donjon']);

    expect(result).not.toBe(ULTIMATE_BREACH_IMAGE_URL);
    expect(result).toBe(DUNGEON_FOR_BOSS.pictureUrl);
  });

  it('priorité 0 (repli) : un seul boss malgré la présence d’un 2e ennemi non-boss -> ne déclenche PAS la brèche ultime', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = resolveFightImageUrl(catalog, ['Ennemi Normal A', 'Boss Avec Donjon']);

    expect(result).not.toBe(ULTIMATE_BREACH_IMAGE_URL);
    expect(result).toBe(DUNGEON_FOR_BOSS.pictureUrl);
  });

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

  it('priorité 2 : plus de 4 familles distinctes parmi les ennemis (sans boss) -> illustration de brèche (heuristique de détection de brèche)', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = resolveFightImageUrl(
      catalog,
      HORDE.map((m) => m[1] as string),
    );

    expect(result).toBe(BREACH_IMAGE_URL);
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
  it('plusieurs boss simultanés correspondant à une brèche ultime connue -> tooltip texte fixe (nom de brèche non résolu), aucun repli (asset statique local)', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const info = resolveFightImageInfo(catalog, ['Boss Ultime Match A', 'Boss Ultime Match B']);

    expect(info.tooltipSource).toEqual({
      kind: 'dungeon',
      names: ULTIMATE_BREACH_MATCH_DUNGEON,
    });
    expect(info.fallbackUrls).toEqual([]);
  });

  it('plusieurs boss simultanés ne correspondant à AUCUNE brèche ultime connue -> pas de tooltip générique, retombe sur le tooltip du 1er boss (référentiel exhaustif)', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const info = resolveFightImageInfo(catalog, ['Boss Avec Donjon', 'Boss Second']);

    expect(info.tooltipSource).toEqual({ kind: 'dungeon', names: DUNGEON_FOR_BOSS });
  });

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

  it('illustration de brèche (horde hétérogène) -> tooltip texte fixe "damageMeter.breach" quand aucune brèche connue ne correspond', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const info = resolveFightImageInfo(
      catalog,
      HORDE.map((m) => m[1] as string),
    );

    expect(info.url).toBe(BREACH_IMAGE_URL);
    expect(info.tooltipSource).toEqual({ kind: 'text', translationKey: 'damageMeter.breach' });
  });

  it('illustration de brèche identifiée précisément via les familles de monstre observées -> tooltipSource de type donjon (nom de LA brèche)', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const info = resolveFightImageInfo(
      catalog,
      HORDE_MATCH.map((m) => m[1] as string),
    );

    expect(info.url).toBe(BREACH_IMAGE_URL);
    expect(info.tooltipSource).toEqual({ kind: 'dungeon', names: BREACH_MATCH_DUNGEON });
  });

  it('brèche ultime identifiée précisément via ses boss observés -> tooltipSource de type donjon (nom de LA brèche ultime)', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const info = resolveFightImageInfo(catalog, ['Boss Ultime Match A', 'Boss Ultime Match B']);

    expect(info.url).toBe(ULTIMATE_BREACH_IMAGE_URL);
    expect(info.tooltipSource).toEqual({ kind: 'dungeon', names: ULTIMATE_BREACH_MATCH_DUNGEON });
  });

  it('aucun ennemi connu -> aucune tooltip', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const info = resolveFightImageInfo(catalog, ['Un Monstre Totalement Inconnu']);

    expect(info.tooltipSource).toBeNull();
  });
});

describe('resolveFightImageInfo (fallbackUrls, bug réel corrigé le 2026-08-24 : image Ankama absente pour certains monstres, ex. "Larve Verte")', () => {
  it('propre image d’un monstre (repli boss/archi/dominant/plus gros dégât) -> 2 replis wakassets (monsters puis monsterIllustrations)', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const info = resolveFightImageInfo(catalog, ['Ennemi Normal A', 'Ennemi Normal B']);

    expect(info.fallbackUrls).toEqual([
      'https://vertylo.github.io/wakassets/monsters/900110.png',
      'https://vertylo.github.io/wakassets/monsterIllustrations/900110.png',
    ]);
  });

  it('illustration de donjon -> aucun repli (pas concerné par le bug Ankama/monstre)', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const info = resolveFightImageInfo(catalog, ['Ennemi Normal A', 'Boss Avec Donjon']);

    expect(info.fallbackUrls).toEqual([]);
  });

  it('illustration de brèche (horde hétérogène) -> aucun repli (asset statique local, pas de CDN tiers)', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const info = resolveFightImageInfo(
      catalog,
      HORDE.map((m) => m[1] as string),
    );

    expect(info.fallbackUrls).toEqual([]);
  });
});

describe('resolveFightTypeClassification (regroupement "Type" de l’historique)', () => {
  it('deux monstres de MÊME famille mais de noms différents -> même clé de groupe (bug corrigé : ne doit plus dépendre du nom)', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const a = resolveFightTypeClassification(catalog, ['Ennemi Normal A']);
    const b = resolveFightTypeClassification(catalog, ['Ennemi Normal A Variant']);

    expect(a.kind).toBe('family');
    expect(a.key).toBe(b.key);
    expect(a.key).toBe('family:20');
    expect(a).toMatchObject({ familyId: 20 });
    expect(b).toMatchObject({ familyId: 20 });
  });

  it('deux monstres SANS famille encyclopédie -> groupes distincts (repli par nom, un seul membre chacun), familyId null', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const a = resolveFightTypeClassification(catalog, ['Sans Famille A']);
    const b = resolveFightTypeClassification(catalog, ['Sans Famille B']);

    expect(a.kind).toBe('family');
    expect(a.key).not.toBe(b.key);
    expect(a).toMatchObject({ familyId: null });
    expect(b).toMatchObject({ familyId: null });
  });

  it('donjon (boss avec donjon référencé) -> kind "dungeon", rang de tri le plus bas', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const info = resolveFightTypeClassification(catalog, ['Ennemi Normal A', 'Boss Avec Donjon']);

    expect(info).toMatchObject({ kind: 'dungeon', key: 'dungeon:500', names: DUNGEON_FOR_BOSS });
  });

  it('brèche -> kind "dungeon" avec son propre nom (pas masqué comme pour l’illustration), rang de tri entre les donjons classiques et les familles', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const dungeonInfo = resolveFightTypeClassification(catalog, ['Boss Avec Donjon']);
    const breachInfo = resolveFightTypeClassification(catalog, ['Boss De Brèche']);
    const familyInfo = resolveFightTypeClassification(catalog, ['Ennemi Normal A']);

    expect(breachInfo).toMatchObject({
      kind: 'dungeon',
      key: 'dungeon:501',
      names: BREACH_DUNGEON,
    });
    expect(dungeonInfo.categoryRank).toBeLessThan(breachInfo.categoryRank);
    expect(breachInfo.categoryRank).toBeLessThan(familyInfo.categoryRank);
  });

  it('horde hétérogène (plus de 4 familles distinctes, sans boss) -> kind "other", rang de tri le plus élevé', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const info = resolveFightTypeClassification(
      catalog,
      HORDE.map((m) => m[1] as string),
    );
    const familyInfo = resolveFightTypeClassification(catalog, ['Ennemi Normal A']);

    expect(info.kind).toBe('other');
    expect(info.categoryRank).toBeGreaterThan(familyInfo.categoryRank);
  });
});

describe('findDungeonForEnemies (rattachement de dungeonId, bugs réels corrigés le 2026-08-28 — voir CLAUDE.md)', () => {
  it('boss PARTAGÉ seul (pas de brèche ultime active) -> son donjon classique', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = findDungeonForEnemies(catalog, ['Boss Partagé']);

    expect(result).toEqual(DUNGEON_FOR_SHARED_BOSS);
  });

  it('boss PARTAGÉ accompagné de son partenaire de brèche ultime -> la brèche ultime, PAS son donjon classique (bug réel : ce même boss, présent seul dans un fight de donjon classique ET dans un fight de brèche ultime, se voyait toujours attribuer le donjon classique)', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = findDungeonForEnemies(catalog, ['Boss Partagé', 'Boss Partagé Partenaire']);

    expect(result).toEqual(ULTIMATE_BREACH_SHARED_BOSS_DUNGEON);
    expect(result).not.toEqual(DUNGEON_FOR_SHARED_BOSS);
  });

  it("horde hétérogène SANS boss dont la composition en familles correspond exactement à une brèche connue -> cette brèche (bug réel : restait null, le combat finissait éclaté en lignes 'famille' isolées dans la carte Récap au lieu d'une section Brèche)", async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = findDungeonForEnemies(
      catalog,
      HORDE_MATCH.map((m) => m[1] as string),
    );

    expect(result).toEqual(BREACH_MATCH_DUNGEON);
  });

  it('horde hétérogène SANS boss ne correspondant à AUCUNE brèche connue -> null (référentiel incomplet, pas de repli générique possible pour un dungeonId)', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = findDungeonForEnemies(
      catalog,
      HORDE.map((m) => m[1] as string),
    );

    expect(result).toBeNull();
  });

  it('4 familles distinctes ou moins (sans boss) -> null, ne déclenche pas la détection de brèche', async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const result = findDungeonForEnemies(
      catalog,
      HORDE_MATCH.slice(0, 4).map((m) => m[1] as string),
    );

    expect(result).toBeNull();
  });
});

describe('resolveFightTypeClassification (bugs réels corrigés le 2026-08-28, mode "Type" de l’historique — voir CLAUDE.md)', () => {
  it("boss PARTAGÉ accompagné de son partenaire de brèche ultime -> kind 'dungeon' sur la brèche ultime, PAS sur son donjon classique", async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const info = resolveFightTypeClassification(catalog, [
      'Boss Partagé',
      'Boss Partagé Partenaire',
    ]);

    expect(info).toMatchObject({
      kind: 'dungeon',
      key: 'dungeon:505',
      names: ULTIMATE_BREACH_SHARED_BOSS_DUNGEON,
    });
  });

  it("horde hétérogène SANS boss identifiée précisément comme une brèche connue -> kind 'dungeon' (pas 'other'), même rang de tri qu'une brèche trouvée par boss unique", async () => {
    const catalog = setupCatalog();
    await catalog.initialize();

    const info = resolveFightTypeClassification(
      catalog,
      HORDE_MATCH.map((m) => m[1] as string),
    );
    const breachByBossInfo = resolveFightTypeClassification(catalog, ['Boss De Brèche']);

    expect(info).toMatchObject({
      kind: 'dungeon',
      key: 'dungeon:502',
      names: BREACH_MATCH_DUNGEON,
    });
    expect(info.categoryRank).toBe(breachByBossInfo.categoryRank);
  });
});
