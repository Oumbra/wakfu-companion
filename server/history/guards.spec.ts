import { describe, expect, it } from 'vitest';
import {
  MAX_FIGHTS_PER_ACCOUNT,
  exceedsFightQuota,
  findUnknownReference,
  type KnownReferences,
} from './guards';
import { MAX_BIND_PARAMS_PER_QUERY, chunkRows } from './ingest';

const KNOWN: KnownReferences = {
  gameServers: new Set(['pandora', 'rubilax', 'ogrest']),
  dungeonIds: new Set([12, 34]),
};

describe('findUnknownReference', () => {
  it('accepte un lot sans référence, ou dont toutes les références existent', () => {
    expect(findUnknownReference([], KNOWN)).toBeNull();
    expect(findUnknownReference([{ gameServer: null, dungeonId: null }], KNOWN)).toBeNull();
    expect(
      findUnknownReference(
        [{ gameServer: 'pandora', dungeonId: 12 }, { gameServer: 'ogrest' }],
        KNOWN,
      ),
    ).toBeNull();
  });

  it('signale un gameServer inconnu (sinon violation de clé étrangère en 500)', () => {
    expect(findUnknownReference([{ gameServer: 'atlantis' }], KNOWN)).toBe(
      'gameServer inconnu : atlantis',
    );
  });

  it('signale un dungeonId inconnu', () => {
    expect(findUnknownReference([{ gameServer: 'pandora', dungeonId: 99 }], KNOWN)).toBe(
      'dungeonId inconnu : 99',
    );
  });
});

describe('exceedsFightQuota', () => {
  it('laisse passer un lot qui n’ajoute rien, même au-delà du quota', () => {
    expect(exceedsFightQuota(MAX_FIGHTS_PER_ACCOUNT + 10, 0)).toBe(false);
  });

  it('laisse passer jusqu’au quota inclus, refuse au-delà', () => {
    expect(exceedsFightQuota(MAX_FIGHTS_PER_ACCOUNT - 5, 5)).toBe(false);
    expect(exceedsFightQuota(MAX_FIGHTS_PER_ACCOUNT - 5, 6)).toBe(true);
    expect(exceedsFightQuota(10, 3, 12)).toBe(true);
  });
});

describe('chunkRows (paramètres liés par requête)', () => {
  it('découpe un lot maximal de participants sous la limite du protocole Postgres', () => {
    // 100 combats × 128 participants, 15 colonnes par ligne (voir fight_participants).
    const rows = Array.from({ length: 100 * 128 }, (_, i) => i);
    const chunks = chunkRows(rows, 15);
    expect(chunks.flat()).toEqual(rows);
    for (const chunk of chunks) {
      expect(chunk.length * 15).toBeLessThanOrEqual(MAX_BIND_PARAMS_PER_QUERY);
    }
    expect(MAX_BIND_PARAMS_PER_QUERY).toBeLessThan(65_535);
  });

  it('ne produit aucune tranche pour un lot vide', () => {
    expect(chunkRows([], 6)).toEqual([]);
  });
});
