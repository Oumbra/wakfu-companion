import { describe, expect, it } from 'vitest';
import {
  MAX_HISTORY_BATCH,
  MAX_PAGE_SIZE,
  parseFightsBody,
  parsePageQuery,
  parsePurchasesBody,
  parseTradesBody,
} from './parse';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

function fightEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientKey: KEY_A,
    startedAt: '2026-08-11T10:00:00.000Z',
    durationMs: 42000,
    won: true,
    turns: 5,
    totalDamage: 1234,
    xpGained: 10,
    kamasGained: 0,
    gameServer: 'pandora',
    participants: [{ side: 'ally', name: 'Oumbra', instanceIndex: 1, damage: 1234 }],
    ...overrides,
  };
}

function purchaseEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientKey: KEY_A,
    itemId: 1234,
    itemName: 'Pain Complet',
    quantity: 4,
    totalCost: 340,
    occurredAt: '2026-08-11T10:00:00.000Z',
    ...overrides,
  };
}

function tradeEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientKey: KEY_A,
    peerName: 'Autre',
    selfName: 'Oumbra',
    occurredAt: '2026-08-11T10:00:00.000Z',
    kamasAcquired: 500,
    kamasGiven: 0,
    items: [
      { direction: 'acquired', itemName: 'Poudre', quantity: 10 },
      { direction: 'acquired', itemName: 'Eclat', quantity: 2 },
      { direction: 'given', itemName: 'Pain', quantity: 1 },
    ],
    ...overrides,
  };
}

describe('parseFightsBody', () => {
  it('accepte un lot valide et normalise les participants', () => {
    const parsed = parseFightsBody({ entries: [fightEntry()] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toHaveLength(1);
    expect(parsed.value[0].startedAt.toISOString()).toBe('2026-08-11T10:00:00.000Z');
    expect(parsed.value[0].participants[0]).toEqual({
      side: 'ally',
      name: 'Oumbra',
      instanceIndex: 1,
      className: null,
      damage: 1234,
      defeated: false,
    });
  });

  it('accepte un lot vide (rien à ingérer)', () => {
    const parsed = parseFightsBody({ entries: [] });
    expect(parsed).toEqual({ ok: true, value: [] });
  });

  it('accepte un combat sans serveur de jeu résolu (champ vide, jamais un repli inventé)', () => {
    const parsed = parseFightsBody({ entries: [fightEntry({ gameServer: null })] });
    expect(parsed.ok && parsed.value[0].gameServer).toBe(null);
  });

  it('refuse un clientKey qui n\'est pas un sha256 hexadécimal', () => {
    expect(parseFightsBody({ entries: [fightEntry({ clientKey: 'fight-1' })] })).toEqual({
      ok: false,
      error: expect.stringContaining('clientKey'),
    });
  });

  it('refuse deux entrées portant la même clé dans un même lot', () => {
    const parsed = parseFightsBody({ entries: [fightEntry(), fightEntry()] });
    expect(parsed).toEqual({ ok: false, error: expect.stringContaining('en double') });
  });

  it('accepte deux clés distinctes dans le même lot', () => {
    const parsed = parseFightsBody({ entries: [fightEntry(), fightEntry({ clientKey: KEY_B })] });
    expect(parsed.ok && parsed.value).toHaveLength(2);
  });

  it('refuse deux participants occupant le même siège (collision de clé primaire)', () => {
    const parsed = parseFightsBody({
      entries: [
        fightEntry({
          participants: [
            { side: 'enemy', name: 'Bouftou', instanceIndex: 1 },
            { side: 'enemy', name: 'Bouftou', instanceIndex: 1 },
          ],
        }),
      ],
    });
    expect(parsed).toEqual({ ok: false, error: expect.stringContaining('participant en double') });
  });

  it('accepte plusieurs instances homonymes distinguées par instanceIndex', () => {
    const parsed = parseFightsBody({
      entries: [
        fightEntry({
          participants: [
            { side: 'enemy', name: 'Bouftou', instanceIndex: 1 },
            { side: 'enemy', name: 'Bouftou', instanceIndex: 2 },
          ],
        }),
      ],
    });
    expect(parsed.ok && parsed.value[0].participants).toHaveLength(2);
  });

  it('refuse un lot au-delà de la borne serveur', () => {
    const entries = Array.from({ length: MAX_HISTORY_BATCH + 1 }, (_, i) =>
      fightEntry({ clientKey: i.toString(16).padStart(64, '0') }),
    );
    expect(parseFightsBody({ entries })).toEqual({
      ok: false,
      error: expect.stringContaining('trop volumineux'),
    });
  });

  it('refuse une date de début invalide', () => {
    expect(parseFightsBody({ entries: [fightEntry({ startedAt: 'hier' })] })).toEqual({
      ok: false,
      error: expect.stringContaining('startedAt'),
    });
  });

  it('refuse une charge utile sans champ entries', () => {
    expect(parseFightsBody({})).toEqual({ ok: false, error: expect.stringContaining('entries') });
  });
});

describe('parsePurchasesBody', () => {
  it('accepte un achat complet', () => {
    const parsed = parsePurchasesBody({ entries: [purchaseEntry()] });
    expect(parsed.ok && parsed.value[0]).toMatchObject({
      itemName: 'Pain Complet',
      quantity: 4,
      totalCost: 340,
      itemId: 1234,
      gameServer: null,
    });
  });

  it("accepte un objet inconnu du catalogue (itemId absent)", () => {
    const parsed = parsePurchasesBody({ entries: [purchaseEntry({ itemId: null })] });
    expect(parsed.ok && parsed.value[0].itemId).toBe(null);
  });

  it('refuse un coût négatif', () => {
    expect(parsePurchasesBody({ entries: [purchaseEntry({ totalCost: -1 })] })).toEqual({
      ok: false,
      error: expect.stringContaining('totalCost'),
    });
  });

  it('refuse une quantité non entière', () => {
    expect(parsePurchasesBody({ entries: [purchaseEntry({ quantity: 1.5 })] })).toEqual({
      ok: false,
      error: expect.stringContaining('quantity'),
    });
  });

  it("refuse un nom d'objet vide", () => {
    expect(parsePurchasesBody({ entries: [purchaseEntry({ itemName: '' })] })).toEqual({
      ok: false,
      error: expect.stringContaining('itemName'),
    });
  });
});

describe('parseTradesBody', () => {
  it('numérote les lignes par direction, de façon déterministe', () => {
    const parsed = parseTradesBody({ entries: [tradeEntry()] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value[0].items).toEqual([
      { direction: 'acquired', lineIndex: 0, itemId: null, itemName: 'Poudre', quantity: 10 },
      { direction: 'acquired', lineIndex: 1, itemId: null, itemName: 'Eclat', quantity: 2 },
      { direction: 'given', lineIndex: 0, itemId: null, itemName: 'Pain', quantity: 1 },
    ]);
  });

  it('produit exactement les mêmes lignes pour la même charge utile rejouée', () => {
    const first = parseTradesBody({ entries: [tradeEntry()] });
    const second = parseTradesBody({ entries: [tradeEntry()] });
    expect(first).toEqual(second);
  });

  it('accepte un échange sans aucun objet (kamas seuls)', () => {
    const parsed = parseTradesBody({ entries: [tradeEntry({ items: [] })] });
    expect(parsed.ok && parsed.value[0].items).toEqual([]);
  });

  it('refuse une direction inconnue', () => {
    const parsed = parseTradesBody({
      entries: [tradeEntry({ items: [{ direction: 'both', itemName: 'x', quantity: 1 }] })],
    });
    expect(parsed).toEqual({ ok: false, error: expect.stringContaining('direction') });
  });
});

describe('parsePageQuery', () => {
  it('applique les valeurs par défaut', () => {
    expect(parsePageQuery(new URLSearchParams())).toEqual({
      ok: true,
      value: { limit: 50, before: null },
    });
  });

  it('lit un curseur before valide', () => {
    const parsed = parsePageQuery(new URLSearchParams('limit=10&before=2026-08-11T10:00:00.000Z'));
    expect(parsed.ok && parsed.value.limit).toBe(10);
    expect(parsed.ok && parsed.value.before?.toISOString()).toBe('2026-08-11T10:00:00.000Z');
  });

  it('refuse une limite hors bornes', () => {
    expect(parsePageQuery(new URLSearchParams(`limit=${MAX_PAGE_SIZE + 1}`)).ok).toBe(false);
    expect(parsePageQuery(new URLSearchParams('limit=0')).ok).toBe(false);
    expect(parsePageQuery(new URLSearchParams('limit=abc')).ok).toBe(false);
  });

  it('refuse un curseur illisible', () => {
    expect(parsePageQuery(new URLSearchParams('before=avant-hier')).ok).toBe(false);
  });
});
