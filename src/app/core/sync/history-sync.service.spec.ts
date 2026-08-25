import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiClientService, type ApiResult } from '../api/api-client.service';
import { LogFileAccessService } from '../services/log-file-access.service';
import { StatsStoreService } from '../services/stats-store.service';
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
    sync.recordFight(fight);
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
      loot: [...fight.loot, { name: 'Objet corrigé', catalogId: 999, quantity: 1 }],
    };

    const sync = TestBed.inject(HistorySyncService);
    await sync.enable('utilisateur-de-test');
    sync.recordFight(corrected);
    await sync.flush();

    expect(sentBatches.flat()).toHaveLength(1);
  });
});
