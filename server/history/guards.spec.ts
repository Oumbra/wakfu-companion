import { describe, expect, it } from 'vitest';
import {
  HISTORY_QUOTA_EXCEEDED_CODE,
  MAX_FIGHTS_PER_ACCOUNT,
  MAX_PACT_EXTRACTIONS_PER_ACCOUNT,
  MAX_PURCHASES_PER_ACCOUNT,
  MAX_TRADES_PER_ACCOUNT,
  exceedsFightQuota,
  exceedsHistoryQuota,
  findUnknownReference,
  historyQuotaExceededBody,
  splitByReferences,
  type KnownReferences,
} from './guards';
import {
  MAX_BIND_PARAMS_PER_QUERY,
  chunkGroups,
  chunkRows,
  participantSeat,
  selectWritableParticipants,
} from './ingest';

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

describe('splitByReferences — référence inconnue : entrée ignorée, pas tout le lot', () => {
  const KEY = (c: string) => c.repeat(64);

  it('écarte seulement les entrées dont une référence est inconnue, en gardant les index d’origine', () => {
    const batch = {
      entries: [
        { clientKey: KEY('a'), gameServer: 'pandora', dungeonId: 12 },
        { clientKey: KEY('b'), gameServer: 'atlantis', dungeonId: null },
        { clientKey: KEY('c'), gameServer: null, dungeonId: 99 },
        { clientKey: KEY('d'), gameServer: null, dungeonId: null },
      ],
      indices: [0, 2, 3, 5],
      rejected: [{ index: 1, error: 'entrée : objet attendu' }],
    };
    const split = splitByReferences(batch, KNOWN);
    expect(split.entries.map((e) => e.clientKey)).toEqual([KEY('a'), KEY('d')]);
    expect(split.indices).toEqual([0, 5]);
    expect(split.rejected).toEqual([
      { index: 1, error: 'entrée : objet attendu' },
      { index: 2, clientKey: KEY('b'), error: 'gameServer inconnu : atlantis' },
      { index: 3, clientKey: KEY('c'), error: 'dungeonId inconnu : 99' },
    ]);
  });

  it('non-régression : un lot dont toutes les références existent passe intact', () => {
    const batch = {
      entries: [{ clientKey: KEY('a'), gameServer: 'ogrest', dungeonId: 34 }],
      indices: [0],
      rejected: [],
    };
    expect(splitByReferences(batch, KNOWN)).toEqual(batch);
  });
});

describe('quotas d’historique (combats, achats, échanges, extractions)', () => {
  it('quotas larges et distincts pour les trois autres historiques', () => {
    expect(MAX_PURCHASES_PER_ACCOUNT).toBe(500_000);
    expect(MAX_TRADES_PER_ACCOUNT).toBe(500_000);
    expect(MAX_PACT_EXTRACTIONS_PER_ACCOUNT).toBe(500_000);
  });

  it('exceedsHistoryQuota : renvoi de l’existant toujours admis, dépassement refusé', () => {
    expect(exceedsHistoryQuota(MAX_PURCHASES_PER_ACCOUNT, 0, MAX_PURCHASES_PER_ACCOUNT)).toBe(
      false,
    );
    expect(exceedsHistoryQuota(499_900, 100, MAX_TRADES_PER_ACCOUNT)).toBe(false);
    expect(exceedsHistoryQuota(499_901, 100, MAX_TRADES_PER_ACCOUNT)).toBe(true);
  });

  it('corps du 403 : même code `history_quota_exceeded` que pour les combats', () => {
    expect(historyQuotaExceededBody("d'achats", MAX_PURCHASES_PER_ACCOUNT)).toEqual({
      error: "quota d'achats atteint (500000 par compte)",
      code: HISTORY_QUOTA_EXCEEDED_CODE,
    });
    expect(HISTORY_QUOTA_EXCEEDED_CODE).toBe('history_quota_exceeded');
  });
});

describe('chunkGroups — les participants d’un combat jamais coupés entre deux requêtes', () => {
  it('garde chaque groupe entier sous la limite de paramètres', () => {
    // 100 combats × 128 participants, 15 colonnes.
    const groups = Array.from({ length: 100 }, (_, f) =>
      Array.from({ length: 128 }, (_, p) => `${f}:${p}`),
    );
    const chunks = chunkGroups(groups, 15);
    expect(chunks.flat()).toEqual(groups.flat());
    for (const chunk of chunks) {
      expect(chunk.length * 15).toBeLessThanOrEqual(MAX_BIND_PARAMS_PER_QUERY);
      const fights = new Set(chunk.map((row) => row.split(':')[0]));
      for (const fight of fights) {
        expect(chunk.filter((row) => row.startsWith(`${fight}:`))).toHaveLength(128);
      }
    }
  });

  it('ignore les groupes vides, ne produit rien pour un lot vide', () => {
    expect(chunkGroups([[], [1, 2], []], 6)).toEqual([[1, 2]]);
    expect(chunkGroups([], 6)).toEqual([]);
  });
});

describe('selectWritableParticipants — pas de nouveau nom sur un combat déjà connu', () => {
  const participants = [
    { name: 'Moi', instanceIndex: 1, side: 'ally' },
    { name: 'Bouftou', instanceIndex: 1, side: 'ally' },
    { name: 'Bouftou', instanceIndex: 2, side: 'enemy' },
    { name: 'Intrus', instanceIndex: 1, side: 'enemy' },
  ];

  it('combat neuf, ou connu sans aucun participant (écriture interrompue) : tout passe', () => {
    expect(selectWritableParticipants(participants, undefined)).toEqual(participants);
    expect(selectWritableParticipants(participants, new Set())).toEqual(participants);
  });

  it('combat connu : seuls les sièges existants sont mis à jour (camp compris), rien n’est ajouté', () => {
    const existing = new Set(['Moi#1', 'Bouftou#1', 'Bouftou#2']);
    expect(selectWritableParticipants(participants, existing)).toEqual(participants.slice(0, 3));
  });

  it('non-régression : renvoi légitime (mêmes sièges, camp/dégâts changés) intégralement écrit', () => {
    const existing = new Set(participants.map(participantSeat));
    const resend = participants.map((p) => ({ ...p, side: p.side === 'ally' ? 'enemy' : 'ally' }));
    expect(selectWritableParticipants(resend, existing)).toEqual(resend);
  });
});
