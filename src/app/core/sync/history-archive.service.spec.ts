import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiClientService, type ApiResult } from '../api/api-client.service';
import { LogFileAccessService } from '../services/log-file-access.service';
import { StatsStoreService } from '../services/stats-store.service';
import { HistoryArchiveService } from './history-archive.service';

const FIXTURES_DIR = join(process.cwd(), 'tests/logs/fr');

function readFixture(name: string): string[] {
  const content = readFileSync(join(FIXTURES_DIR, name), 'utf-8');
  return content.split(/\r?\n/).filter((line) => line.length > 0);
}

function feed(access: LogFileAccessService, lines: string[]): void {
  access.newLines$.next({ lines, isInitialLoad: true });
}

/**
 * Régression du bug réel constaté le 2026-08-25 (compte de test
 * `e7ca6cfe-5dcf-4864-b91f-3432468324d9`, vidéo + `SELECT * FROM fights` fournis par
 * l'utilisateur) : `HistoryArchiveService.toFightRecord` reconstruisait `FightRecord.time` à
 * partir du seul `startedAt` (= DÉBUT du combat, `FightPayload.startedAt`), alors que ce champ est
 * par construction l'heure de FIN du combat côté session (voir
 * `StatsStoreService.finalizeFight`) — c'est aussi la convention utilisée par
 * `fightSignature`/`fightDedupKey`. Résultat : pour tout combat de durée non nulle, la clé de
 * dédoublonnage calculée depuis l'archive du compte ne correspondait JAMAIS à celle du même combat
 * côté session → `mergedFights` affichait chaque combat archivé EN PLUS de sa copie de session, au
 * lieu de la remplacer (12 combats réels affichés en 24 lignes dans le cas réel constaté).
 */
describe('HistoryArchiveService — fusion session/compte (mergedFights)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('un combat déjà archivé sur le compte ne doit apparaître qu’une seule fois, pas en double avec sa copie de session', async () => {
    // 1. Un vrai combat parsé côté session, comme s'il venait d'être rejoué depuis le fichier de log.
    TestBed.configureTestingModule({});
    const stats = TestBed.inject(StatsStoreService);
    feed(
      TestBed.inject(LogFileAccessService),
      readFixture('fight_single-account_end_after-all-monsters-play.log'),
    );
    const sessionFight = stats.fightHistory()[0];
    expect(sessionFight).toBeDefined();
    expect(sessionFight.durationMs).toBeGreaterThan(0); // sans quoi le bug ne se manifesterait pas

    // 2. Un faux serveur qui renvoie CE MÊME combat comme s'il était déjà archivé sur le compte —
    // seul `startedAt` (= début, comme le vrai payload envoyé par HistorySyncService.recordFight)
    // et `durationMs` sont dérivés du combat de session ; le reste (participants, résultat) est
    // recopié à l'identique.
    const startedAtIso = new Date(sessionFight.fullTimestampMs).toISOString();
    const api: Partial<ApiClientService> = {
      setUnauthorizedHandler: () => undefined,
      getJson: async <T>(path: string) => {
        if (!path.startsWith('/history/fights')) {
          return { ok: false, error: { kind: 'offline' } } as ApiResult<T>;
        }
        return {
          ok: true,
          data: {
            entries: [
              {
                clientKey: 'test-client-key',
                startedAt: startedAtIso,
                durationMs: sessionFight.durationMs,
                won: sessionFight.result === 'won',
                turns: sessionFight.turns,
                totalDamage: sessionFight.rows.reduce((sum, r) => sum + r.total, 0),
                xpGained: sessionFight.xp.reduce((sum, x) => sum + x.amount, 0),
                kamasGained: sessionFight.kamas,
                gameServer: null,
                participants: sessionFight.rows.map((row) => ({
                  // `side` n'entre pas dans la clé de dédoublonnage (fightDedupKey) : peu importe
                  // ici, seuls name/instanceIndex comptent.
                  side: 'enemy' as const,
                  name: row.name,
                  instanceIndex: row.instanceIndex,
                  className: null,
                  damage: row.total,
                  defeated: row.defeated,
                  spells: null,
                  xpGained: null,
                })),
                loot: [],
              },
            ],
            nextBefore: null,
          } as T,
        };
      },
      requestJson: async <T>() => ({ ok: true, data: undefined as T }),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });

    // Rejoue le même combat côté session (nouvel injecteur, mêmes services) puis charge l'archive.
    const stats2 = TestBed.inject(StatsStoreService);
    feed(
      TestBed.inject(LogFileAccessService),
      readFixture('fight_single-account_end_after-all-monsters-play.log'),
    );
    expect(stats2.fightHistory()).toHaveLength(1);

    const archive = TestBed.inject(HistoryArchiveService);
    await archive.loadMore('fight');

    expect(archive.mergedFights()).toHaveLength(1);
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Faux serveur d'échanges (`trade`, le type le plus simple à peupler — pas d'objets/loot à
 * résoudre via le catalogue) : `TOTAL_TRADES` entrées espacées d'un jour, servies par pages de
 * `MOCK_PAGE_SIZE` (volontairement petit et distinct du vrai `PAGE_SIZE` de production, pour que le
 * test exerce plusieurs pages sans avoir à générer des centaines d'entrées) quel que soit le
 * `limit` réellement demandé — seul `before` (curseur) fait varier la réponse.
 */
function createTradesApiMock(now: number, totalTrades: number, mockPageSize: number) {
  const all = Array.from({ length: totalTrades }, (_, i) => ({
    clientKey: `trade-${i}`,
    peerName: 'Voisin',
    selfName: 'Moi',
    occurredAt: new Date(now - i * DAY_MS).toISOString(),
    kamasAcquired: 0,
    kamasGiven: 0,
    gameServer: null,
    acquired: [],
    given: [],
  }));
  let calls = 0;
  const api: Partial<ApiClientService> = {
    setUnauthorizedHandler: () => undefined,
    getJson: async <T>(path: string) => {
      if (!path.startsWith('/history/trades')) {
        return { ok: false, error: { kind: 'offline' } } as ApiResult<T>;
      }
      calls++;
      const beforeMatch = /before=([^&]+)/.exec(path);
      const before = beforeMatch ? decodeURIComponent(beforeMatch[1]) : null;
      // `before` désigne ici l'`occurredAt` du DERNIER élément déjà servi (voir `nextBefore`
      // ci-dessous) — la page suivante reprend juste APRÈS lui, jamais en le réincluant.
      const startIndex = before === null ? 0 : all.findIndex((e) => e.occurredAt === before) + 1;
      const page = all.slice(startIndex);
      const entries = page.slice(0, mockPageSize);
      const nextBefore =
        entries.length < page.length ? entries[entries.length - 1].occurredAt : null;
      return { ok: true, data: { entries, nextBefore } } as ApiResult<T>;
    },
    requestJson: async <T>() => ({ ok: true, data: undefined as T }),
  };
  return { api, callCount: () => calls };
}

/**
 * `loadMoreForSpan` (menu "Charger plus" — voir LoadMoreScopeMenuComponent) : enchaîne les pages
 * jusqu'à couvrir la portée demandée, sans tout charger d'un coup ni s'arrêter avant.
 */
describe('HistoryArchiveService — loadMoreForSpan', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("charge juste assez de pages pour couvrir la portée demandée ('1 semaine')", async () => {
    const now = Date.now();
    const { api, callCount } = createTradesApiMock(now, 31, 5);
    TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });
    const archive = TestBed.inject(HistoryArchiveService);

    await archive.loadMoreForSpan('trade', WEEK_MS);

    // Il faut remonter jusqu'à un événement vieux d'au moins 7 jours (index 7, le 8e) — avec des
    // pages de 5, ça tombe au milieu de la 2e page : 2 requêtes, 10 entrées chargées au total.
    expect(callCount()).toBe(2);
    expect(archive.trades()).toHaveLength(10);
    const oldest = archive.trades()[archive.trades().length - 1];
    expect(now - oldest.fullTimestampMs).toBeGreaterThanOrEqual(WEEK_MS);
  });

  it("s'arrête à l'épuisement de l'archive plutôt que de boucler indéfiniment si la portée demandée dépasse ce qui existe", async () => {
    const now = Date.now();
    const { api, callCount } = createTradesApiMock(now, 12, 5);
    TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });
    const archive = TestBed.inject(HistoryArchiveService);

    // "1 an" alors que l'archive ne contient que 12 jours d'échanges.
    await archive.loadMoreForSpan('trade', 365 * DAY_MS);

    expect(archive.trades()).toHaveLength(12);
    expect(archive.hasMore('trade')).toBe(false);
    expect(callCount()).toBe(3); // ceil(12 / 5)
  });
});
