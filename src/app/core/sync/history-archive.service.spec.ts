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
