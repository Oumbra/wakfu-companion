import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiClientService, type ApiResult } from '../api/api-client.service';
import { CatalogService } from '../api/catalog.service';
import { LogFileAccessService } from '../services/log-file-access.service';
import { PersistenceService } from '../services/persistence.service';
import { FightRecord, StatsStoreService } from '../services/stats-store.service';
import { computeClientKey } from './client-key.util';
import { fightSignature } from './history-event.model';
import { HistorySyncService } from './history-sync.service';
import { SyncQueueService } from './sync-queue.service';
import { SyncedFightsRegistry } from './synced-fights-registry.service';

const FIXTURES_DIR = join(process.cwd(), 'tests/logs/fr');

function readFixture(name: string): string[] {
  const content = readFileSync(join(FIXTURES_DIR, name), 'utf-8');
  return content.split(/\r?\n/).filter((line) => line.length > 0);
}

function feed(access: LogFileAccessService, lines: string[]): void {
  access.newLines$.next({ lines, isInitialLoad: true });
}

/** Capture les entrées réellement envoyées à `POST /history/fights`, sans simuler l'idempotence
 * serveur (hors-sujet ici, déjà couvert par stats-store.service.spec.ts) — seul le nombre de
 * requêtes/entrées envoyées compte pour ce test. */
function configureApi(sentBatches: unknown[][]): void {
  const api: Partial<ApiClientService> = {
    setUnauthorizedHandler: () => undefined,
    getJson: async <T>() => ({ ok: false, error: { kind: 'offline' } }) as ApiResult<T>,
    requestJson: async <T>(
      _path: string,
      options: { method: string; body?: unknown },
    ): Promise<ApiResult<T>> => {
      const entries = (options.body as { entries?: unknown[] })?.entries ?? [];
      sentBatches.push(entries);
      return { ok: true, data: { accepted: [], inserted: entries.length } as T };
    },
  };
  TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });
}

/**
 * Régression de l'optimisation de trafic ajoutée le 2026-08-25 (suite du fix de dédoublonnage
 * d'affichage) : `HistorySyncService.recordFight` ne doit RIEN renvoyer pour un combat que
 * `SyncedFightsRegistry` connaît déjà avec un contenu strictement identique (participants + butin)
 * — mais doit continuer à renvoyer une VRAIE correction (butin réattribué), jamais la perdre
 * silencieusement au prétexte que le combat, lui, est déjà connu.
 */
describe('HistorySyncService — court-circuit sur combat déjà archivé (SyncedFightsRegistry)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("n'envoie rien pour un combat déjà connu de l'archive avec un contenu identique", async () => {
    const sentBatches: unknown[][] = [];
    configureApi(sentBatches);

    const stats = TestBed.inject(StatsStoreService);
    feed(
      TestBed.inject(LogFileAccessService),
      readFixture('fight_single-account_end_after-all-monsters-play.log'),
    );
    const fight = stats.fightHistory()[0];
    expect(fight).toBeDefined();

    TestBed.inject(SyncedFightsRegistry).register([fight]);

    const sync = TestBed.inject(HistorySyncService);
    await sync.enable('utilisateur-de-test');
    sync.recordFight(fight, stats.fightHistory());
    await sync.flush();

    expect(sentBatches.flat()).toHaveLength(0);
  });

  it('envoie bien une correction de butin sur un combat par ailleurs déjà connu', async () => {
    const sentBatches: unknown[][] = [];
    configureApi(sentBatches);

    const stats = TestBed.inject(StatsStoreService);
    feed(
      TestBed.inject(LogFileAccessService),
      readFixture('fight_single-account_end_after-all-monsters-play.log'),
    );
    const fight = stats.fightHistory()[0];
    expect(fight).toBeDefined();

    // L'archive connaît la version SANS cette ligne de butin — la correction en ajoute une.
    TestBed.inject(SyncedFightsRegistry).register([fight]);
    const corrected = {
      ...fight,
      loot: [
        ...fight.loot,
        { name: 'Objet corrigé', catalogId: 999, quantity: 1, confidence: 'unknown' as const },
      ],
    };

    const sync = TestBed.inject(HistorySyncService);
    await sync.enable('utilisateur-de-test');
    sync.recordFight(corrected, stats.fightHistory());
    await sync.flush();

    expect(sentBatches.flat()).toHaveLength(1);
  });
});

/**
 * Rattachement de donjon (`fights.dungeonId`/`fights.dungeonRunKey`, voir server/db/schema.ts) —
 * ajouté le 2026-08-26 à la demande de l'utilisateur pour permettre un regroupement des combats de
 * donjon directement en base, sans rejouer `groupDungeonRuns` côté stats. Un vrai `CatalogService`
 * (chargé depuis un fixture minimal, même mécanique que catalog.service.spec.ts) est nécessaire
 * ici, contrairement au reste du fichier : `HistorySyncService.resolveDungeonAssignment` s'appuie
 * dessus pour reconnaître un boss de donjon parmi les ennemis d'un combat.
 */
describe('HistorySyncService — rattachement de donjon', () => {
  const DUNGEON_SOLO_ID = 500;
  const DUNGEON_DUO_ID = 501;
  const BOSS_SOLO = 'Boss Solo';
  const BOSS_DUO = 'Boss Duo';

  function ok<T>(data: T): ApiResult<T> {
    return { ok: true, data };
  }
  function offline<T>(): ApiResult<T> {
    return { ok: false, error: { kind: 'offline' } };
  }

  /** Tuple `/catalog/` d'un monstre — voir catalog.service.spec.ts (MONSTER_TUPLE) pour l'ordre des
   * champs : `[id, fr, en, es, pt, gfxId, family, isBoss, isArchi, isDominant]`. */
  function bossTuple(id: number, name: string): unknown[] {
    return [id, name, name, name, name, String(id), -1, 1, 0, 0];
  }

  function dungeonRow(
    id: number,
    type: 'ULTIMATE_BOSS' | 'TWO_ROOMS',
    bossId: number,
  ): Record<string, unknown> {
    return {
      id,
      fr: `Donjon ${id}`,
      en: `Dungeon ${id}`,
      es: `Mazmorra ${id}`,
      pt: `Masmorra ${id}`,
      level: 1,
      bracket: 1,
      type,
      bossMonsterId: [bossId],
      monsterFamilyId: [],
      pictureUrl: 'https://example.test/dungeon.png',
      wakassetsAvailable: true,
      hasPreBossArchi: false,
    };
  }

  function configureApiWithCatalog(sentBatches: unknown[][]): void {
    const api: Partial<ApiClientService> = {
      setUnauthorizedHandler: () => undefined,
      getJson: async <T>(path: string) => {
        if (path === '/catalog/version') return ok({ indexHash: 'v1' }) as ApiResult<T>;
        if (path === '/catalog/') {
          return ok({
            items: [],
            monsters: [bossTuple(900, BOSS_SOLO), bossTuple(901, BOSS_DUO)],
          }) as ApiResult<T>;
        }
        if (path === '/dungeons') {
          return ok([
            dungeonRow(DUNGEON_SOLO_ID, 'ULTIMATE_BOSS', 900),
            dungeonRow(DUNGEON_DUO_ID, 'TWO_ROOMS', 901),
          ]) as ApiResult<T>;
        }
        if (path === '/monster-families') return ok([]) as ApiResult<T>;
        return offline<T>();
      },
      requestJson: async <T>(
        _path: string,
        options: { method: string; body?: unknown },
      ): Promise<ApiResult<T>> => {
        const entries = (options.body as { entries?: unknown[] })?.entries ?? [];
        sentBatches.push(entries);
        return { ok: true, data: { accepted: [], inserted: entries.length } as T };
      },
    };
    TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });
  }

  /** IndexedDB (cache catalogue, voir `PersistenceService.getCacheEntry`/`setCacheEntry`) n'existe
   * pas dans cet environnement de test — neutralisées sur l'instance réelle (pas un provider de
   * substitution complet : `CharacterRosterService`/`SyncQueueService`, injectés transitivement,
   * ont besoin du reste de `PersistenceService`, lui bien fonctionnel ici via `localStorage`). */
  async function initializeCatalog(): Promise<void> {
    const persistence = TestBed.inject(PersistenceService);
    persistence.getCacheEntry = async () => undefined;
    persistence.setCacheEntry = async () => undefined;
    await TestBed.inject(CatalogService).initialize();
  }

  /** `FightRecord` minimal construit à la main (pas de vrai fichier de log) : seuls
   * `id`/`time`/`result`/`rows[].name` importent pour `resolveDungeonAssignment`. */
  function fightRecord(
    id: number,
    time: string,
    result: 'won' | 'lost',
    enemyNames: readonly string[],
  ): FightRecord {
    return {
      id,
      time,
      fullTimestampMs: id * 60_000,
      result,
      rows: enemyNames.map((name) => ({
        name,
        total: 100,
        spells: [],
        defeated: result === 'won',
        instanceIndex: 1,
        instanceCount: 1,
      })),
      healRows: [],
      armorRows: [],
      loot: [],
      kamas: 0,
      turns: 1,
      durationMs: 1000,
      xp: [],
      challengesPassed: 0,
      challengesFailed: 0,
    };
  }

  beforeEach(() => {
    localStorage.clear();
  });

  it('rattache un combat de boss de donjon à un seul combat (dungeonId + dungeonRunKey)', async () => {
    const sentBatches: unknown[][] = [];
    configureApiWithCatalog(sentBatches);
    await initializeCatalog();

    const boss = fightRecord(1, '10:00:00,000', 'won', [BOSS_SOLO]);
    const sync = TestBed.inject(HistorySyncService);
    await sync.enable('utilisateur-de-test');
    sync.recordFight(boss, [boss]);
    await sync.flush();

    const sent = sentBatches.flat() as Array<Record<string, unknown>>;
    expect(sent).toHaveLength(1);
    expect(sent[0]['dungeonId']).toBe(DUNGEON_SOLO_ID);
    expect(sent[0]['dungeonRunKey']).toMatch(/^[0-9a-f]{64}$/);
  });

  it("n'envoie aucun rattachement pour une salle dont le boss n'est pas encore dans l'historique connu", async () => {
    const sentBatches: unknown[][] = [];
    configureApiWithCatalog(sentBatches);
    await initializeCatalog();

    // 'Gobelin' n'est ni un boss ni même un monstre connu du catalogue : une salle ordinaire.
    const room = fightRecord(1, '10:00:00,000', 'won', ['Gobelin']);
    const sync = TestBed.inject(HistorySyncService);
    await sync.enable('utilisateur-de-test');
    sync.recordFight(room, [room]);
    await sync.flush();

    const sent = sentBatches.flat() as Array<Record<string, unknown>>;
    expect(sent).toHaveLength(1);
    expect(sent[0]['dungeonId']).toBeNull();
    expect(sent[0]['dungeonRunKey']).toBeNull();
  });

  it(
    "rattache la salle et le boss d'un run multi-salles au même dungeonRunKey (celui du boss) dès " +
      'que celui-ci complète le run, y compris pour une salle déjà envoyée sans rattachement',
    async () => {
      const sentBatches: unknown[][] = [];
      configureApiWithCatalog(sentBatches);
      await initializeCatalog();

      const room = fightRecord(1, '10:00:00,000', 'won', ['Gobelin']);
      const boss = fightRecord(2, '10:05:00,000', 'won', [BOSS_DUO]);

      const sync = TestBed.inject(HistorySyncService);
      await sync.enable('utilisateur-de-test');

      // La salle part seule en premier (le boss n'a pas encore été combattu) : pas de rattachement.
      sync.recordFight(room, [room]);
      await sync.flush();
      expect((sentBatches.flat() as Array<Record<string, unknown>>)[0]['dungeonId']).toBeNull();

      // Le boss complète le run — historique connu = [boss, room], plus récent d'abord.
      sync.recordFight(boss, [boss, room]);
      await sync.flush();

      const sent = sentBatches.flat() as Array<Record<string, unknown>>;
      // 1 envoi pour la salle (round 1) + 2 pour le round 2 (boss ET salle réenfilée).
      expect(sent).toHaveLength(3);
      const bossEntry = sent.find((e) => e['fightId'] === 2);
      // Le 2e envoi de la salle (round 2) est le dernier de la liste — reverse() plutôt que
      // `findLast` (indisponible avec la cible ES actuelle du tsconfig de test).
      const roomEntry = [...sent].reverse().find((e) => e['fightId'] === 1);
      expect(bossEntry?.['dungeonId']).toBe(DUNGEON_DUO_ID);
      expect(roomEntry?.['dungeonId']).toBe(DUNGEON_DUO_ID);
      expect(roomEntry?.['dungeonRunKey']).toBe(bossEntry?.['dungeonRunKey']);

      // `dungeonRunKey` du run == le `clientKey` du boss lui-même (voir doc de FightPayload).
      const bossSignature = fightSignature({
        time: boss.time,
        fightId: boss.id,
        result: boss.result,
        participants: boss.rows,
      });
      const expectedRunKey = await computeClientKey('utilisateur-de-test', 'fight', bossSignature);
      expect(bossEntry?.['dungeonRunKey']).toBe(expectedRunKey);
      expect(bossEntry?.['clientKey']).toBe(expectedRunKey);
    },
  );
});
