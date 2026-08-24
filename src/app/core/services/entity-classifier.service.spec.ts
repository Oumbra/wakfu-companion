import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { EntityClassifierService } from './entity-classifier.service';
import { CatalogService } from '../api/catalog.service';
import { ApiClientService, ApiResult } from '../api/api-client.service';
import { PersistenceService } from './persistence.service';

// Tuple v3 (server/catalog/compact-index.ts) :
// [id, fr, en, es, pt, gfxId, family(-1 si null), isBoss(0|1), isArchi(0|1), isDominant(0|1)]
const BOSS_MONSTER = [
  5301,
  "K'abah'al, Gardien de la route des morts",
  'en',
  'es',
  'pt',
  '5301',
  73,
  1,
  0,
  0,
];

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

/** Peuple un vrai CatalogService (pas un mock) avec BOSS_MONSTER, comme fight-image.util.spec.ts —
 * nécessaire pour exercer `isConfirmedEnemy` (base sur `catalog.isKnownWakfuMonsterName`), le vrai
 * signal exploité par le correctif du 2026-08-24 (voir registerSummonJoin ci-dessous). Le mock
 * PersistenceService couvre aussi `getJson`/`setJson` (contrairement à fight-image.util.spec.ts) :
 * EntityClassifierService et les services qu'il injecte (roster, etc.) en dépendent au constructeur. */
function setup(): { classifier: EntityClassifierService; catalog: CatalogService } {
  const getCacheEntry = async () => undefined;
  const setCacheEntry = async () => undefined;
  const getJson = async (path: string) => {
    if (path === '/catalog/version') return ok({ indexHash: 'fixture' });
    if (path === '/catalog/') return ok({ items: [], monsters: [BOSS_MONSTER] });
    if (path === '/dungeons') return ok([]);
    if (path === '/monster-families') return ok([]);
    throw new Error(`unexpected path in test: ${path}`);
  };

  TestBed.configureTestingModule({
    providers: [
      {
        provide: PersistenceService,
        useValue: {
          getCacheEntry,
          setCacheEntry,
          getJson: () => undefined,
          setJson: () => undefined,
        },
      },
      { provide: ApiClientService, useValue: { getJson } },
    ],
  });
  return {
    classifier: TestBed.inject(EntityClassifierService),
    catalog: TestBed.inject(CatalogService),
  };
}

describe(
  'EntityClassifierService.registerSummonJoin — bug réel corrigé le 2026-08-24 ' +
    '(combat "K\'abah\'al, Gardien de la route des morts")',
  () => {
    beforeEach(() => localStorage.clear());

    it(
      'un vrai monstre du référentiel (ex. boss) reste ennemi même si LogParser le signale à tort ' +
        'comme une invocation d’un allié (mécanique de boss détournant "X: Invoque ...")',
      async () => {
        const { classifier, catalog } = setup();
        await catalog.initialize();

        // "Fayto" est un allié confirmé (rejoint le combat avec isControlledByAI=false).
        classifier.registerFighterJoin('Fayto', false, 4);
        // Mécanique de boss : le jeu affiche "Fayto: Invoque un(e) K'abah'al..." dans le log — LogParser
        // (SUMMON_ANNOUNCE_RE) le détecte comme une invocation classique, avec Fayto comme invocateur.
        classifier.registerSummonJoin("K'abah'al, Gardien de la route des morts", 'Fayto');

        expect(classifier.classify("K'abah'al, Gardien de la route des morts")).toBe('enemy');
      },
    );

    it('une VRAIE invocation alliée (absente du référentiel) continue d’hériter du camp de son invocateur', async () => {
      const { classifier, catalog } = setup();
      await catalog.initialize();

      classifier.registerFighterJoin('Fayto', false, 4);
      classifier.registerSummonJoin('Dark Lapino', 'Fayto');

      expect(classifier.classify('Dark Lapino')).toBe('ally');
    });

    it('une invocation héritée d’un ennemi (absente du référentiel) reste ennemie', async () => {
      const { classifier, catalog } = setup();
      await catalog.initialize();

      classifier.registerFighterJoin('Bouftou', true, 1);
      classifier.registerSummonJoin('Xélor Miroir', 'Bouftou');

      expect(classifier.classify('Xélor Miroir')).toBe('enemy');
    });
  },
);
