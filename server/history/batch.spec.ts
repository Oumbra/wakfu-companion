/**
 * Déroulé des `POST /api/v1/history/*` (correctif du 2026-09-23) : entrées invalides ignorées et
 * signalées dans `rejected`, lot valide accepté en 200 ; 400 réservé au corps globalement
 * malformé ; 403 `history_quota_exceeded` sur dépassement de quota ; jamais d'écriture d'une
 * entrée invalide. Accès base simulés (`HistoryBatchDeps`).
 */

import { describe, expect, it, vi } from 'vitest';
import { processHistoryBatch, type HistoryBatchDeps } from './batch';
import {
  HISTORY_QUOTA_EXCEEDED_CODE,
  MAX_FIGHTS_PER_ACCOUNT,
  MAX_PURCHASES_PER_ACCOUNT,
} from './guards';
import {
  MAX_HISTORY_BATCH,
  parseFightsBatch,
  parsePurchasesBatch,
  type FightInput,
  type PurchaseInput,
} from './parse';

const NOW = new Date('2026-09-23T12:00:00Z');
const KEY = (c: string) => c.repeat(64);
const FIGHTS = { parse: parseFightsBatch, quotaLabel: 'de combats', quota: MAX_FIGHTS_PER_ACCOUNT };
const PURCHASES = {
  parse: parsePurchasesBatch,
  quotaLabel: "d'achats",
  quota: MAX_PURCHASES_PER_ACCOUNT,
};

function fight(clientKey: string, overrides: Record<string, unknown> = {}) {
  return {
    clientKey,
    startedAt: '2026-09-20T10:00:00.000Z',
    won: true,
    gameServer: 'pandora',
    participants: [{ side: 'ally', name: 'Oumbra', instanceIndex: 1, damage: 10 }],
    ...overrides,
  };
}

function deps<T extends { clientKey: string }>(
  overrides: Partial<HistoryBatchDeps<T>> = {},
): HistoryBatchDeps<T> & { written: T[] } {
  const written: T[] = [];
  return {
    written,
    loadKnownReferences: vi.fn(async () => ({
      gameServers: new Set(['pandora']),
      dungeonIds: new Set([12]),
    })),
    withinQuota: vi.fn(async () => true),
    ingest: vi.fn(async (entries: readonly T[]) => {
      written.push(...entries);
      return { accepted: entries.map((e) => e.clientKey), inserted: entries.length };
    }),
    ...overrides,
  };
}

describe('processHistoryBatch', () => {
  it('non-régression : lot valide → 200 avec accepted/inserted inchangés et rejected vide', async () => {
    const d = deps<FightInput>();
    const outcome = await processHistoryBatch(
      { entries: [fight(KEY('a')), fight(KEY('b'))] },
      NOW,
      FIGHTS,
      d,
    );
    expect(outcome).toEqual({
      status: 200,
      body: { accepted: [KEY('a'), KEY('b')], inserted: 2, rejected: [] },
    });
  });

  it('entrée datée de 1970 : ignorée, le reste du lot est écrit (plus de 400 bloquant)', async () => {
    const d = deps<FightInput>();
    const outcome = await processHistoryBatch(
      {
        entries: [
          fight(KEY('a')),
          fight(KEY('b'), { startedAt: '1970-01-01T00:00:00.000Z' }),
          fight(KEY('c')),
        ],
      },
      NOW,
      FIGHTS,
      d,
    );
    expect(outcome.status).toBe(200);
    if (outcome.status !== 200) return;
    expect(d.written.map((f) => f.clientKey)).toEqual([KEY('a'), KEY('c')]);
    expect(outcome.body.accepted).toEqual([KEY('a'), KEY('c')]);
    expect(outcome.body.rejected).toEqual([
      { index: 1, clientKey: KEY('b'), error: expect.stringContaining('2012') },
    ]);
  });

  it('toutes les entrées invalides : 200, rien écrit, aucune lecture de quota', async () => {
    const d = deps<FightInput>();
    const outcome = await processHistoryBatch(
      { entries: [fight(KEY('a'), { startedAt: '1970-01-01T00:00:00Z' }), 'x'] },
      NOW,
      FIGHTS,
      d,
    );
    expect(outcome).toMatchObject({ status: 200, body: { accepted: [], inserted: 0 } });
    if (outcome.status !== 200) return;
    expect(outcome.body.rejected.map((r) => r.index)).toEqual([0, 1]);
    expect(d.withinQuota).not.toHaveBeenCalled();
    expect(d.ingest).not.toHaveBeenCalled();
  });

  it('référence inconnue (serveur de jeu, donjon) : entrée ignorée au lieu d’un 400 ou d’un 500', async () => {
    const d = deps<FightInput>();
    const outcome = await processHistoryBatch(
      {
        entries: [
          fight(KEY('a'), { gameServer: 'atlantis' }),
          fight(KEY('b'), { dungeonId: 99, dungeonRunKey: KEY('f') }),
          fight(KEY('c'), { dungeonId: 12, dungeonRunKey: KEY('f') }),
        ],
      },
      NOW,
      FIGHTS,
      d,
    );
    expect(outcome.status).toBe(200);
    if (outcome.status !== 200) return;
    expect(d.written.map((f) => f.clientKey)).toEqual([KEY('c')]);
    expect(outcome.body.rejected.map((r) => [r.index, r.clientKey])).toEqual([
      [0, KEY('a')],
      [1, KEY('b')],
    ]);
  });

  it('doublon de clientKey : la première occurrence est écrite, une seule fois', async () => {
    const d = deps<PurchaseInput>();
    const purchase = (quantity: number) => ({
      clientKey: KEY('a'),
      itemId: 1,
      quantity,
      totalCost: 10,
      occurredAt: '2026-09-20T10:00:00Z',
    });
    const outcome = await processHistoryBatch(
      { entries: [purchase(1), purchase(2)] },
      NOW,
      PURCHASES,
      d,
    );
    expect(outcome.status).toBe(200);
    expect(d.written).toHaveLength(1);
    expect(d.written[0].quantity).toBe(1);
  });

  it('corps globalement malformé : 400, rien lu en base', async () => {
    const d = deps<FightInput>();
    expect(await processHistoryBatch({ nope: [] }, NOW, FIGHTS, d)).toMatchObject({ status: 400 });
    const tooMany = Array.from({ length: MAX_HISTORY_BATCH + 1 }, () => fight(KEY('a')));
    expect(await processHistoryBatch({ entries: tooMany }, NOW, FIGHTS, d)).toMatchObject({
      status: 400,
    });
    expect(d.loadKnownReferences).not.toHaveBeenCalled();
  });

  it('quota atteint : 403 history_quota_exceeded, lot refusé en entier (inchangé)', async () => {
    const d = deps<PurchaseInput>({ withinQuota: vi.fn(async () => false) });
    const outcome = await processHistoryBatch(
      {
        entries: [
          {
            clientKey: KEY('a'),
            itemId: 1,
            quantity: 1,
            totalCost: 1,
            occurredAt: '2026-09-01T00:00:00Z',
          },
        ],
      },
      NOW,
      PURCHASES,
      d,
    );
    expect(outcome).toEqual({
      status: 403,
      body: { error: expect.stringContaining("quota d'achats"), code: HISTORY_QUOTA_EXCEEDED_CODE },
    });
    expect(d.ingest).not.toHaveBeenCalled();
  });

  it('le quota ne compte que les entrées valides', async () => {
    const d = deps<FightInput>();
    await processHistoryBatch(
      { entries: [fight(KEY('a')), fight(KEY('b'), { startedAt: 'pas une date' })] },
      NOW,
      FIGHTS,
      d,
    );
    expect(d.withinQuota).toHaveBeenCalledWith([KEY('a')]);
  });
});
