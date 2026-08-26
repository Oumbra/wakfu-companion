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
      monsterId: null,
      instanceIndex: 1,
      className: null,
      damage: 1234,
      defeated: false,
      spells: [],
      xpGained: 0,
    });
  });

  it('accepte et transporte un monsterId résolu côté ennemi', () => {
    const parsed = parseFightsBody({
      entries: [
        fightEntry({
          participants: [{ side: 'enemy', name: 'Bouftou', instanceIndex: 1, monsterId: 1 }],
        }),
      ],
    });
    expect(parsed.ok && parsed.value[0].participants[0].monsterId).toBe(1);
  });

  it('refuse un monsterId non entier', () => {
    const parsed = parseFightsBody({
      entries: [
        fightEntry({
          participants: [{ side: 'enemy', name: 'Bouftou', instanceIndex: 1, monsterId: 1.5 }],
        }),
      ],
    });
    expect(parsed).toEqual({ ok: false, error: expect.stringContaining('monsterId') });
  });

  it('accepte un lot vide (rien à ingérer)', () => {
    const parsed = parseFightsBody({ entries: [] });
    expect(parsed).toEqual({ ok: true, value: [] });
  });

  it('accepte un combat sans serveur de jeu résolu (champ vide, jamais un repli inventé)', () => {
    const parsed = parseFightsBody({ entries: [fightEntry({ gameServer: null })] });
    expect(parsed.ok && parsed.value[0].gameServer).toBe(null);
  });

  it('accepte et transporte un rattachement de donjon (dungeonId + dungeonRunKey)', () => {
    const parsed = parseFightsBody({
      entries: [fightEntry({ dungeonId: 500, dungeonRunKey: KEY_B })],
    });
    expect(parsed.ok && parsed.value[0].dungeonId).toBe(500);
    expect(parsed.ok && parsed.value[0].dungeonRunKey).toBe(KEY_B);
  });

  it('accepte un combat sans rattachement de donjon (champs absents, jamais requis)', () => {
    const parsed = parseFightsBody({ entries: [fightEntry()] });
    expect(parsed.ok && parsed.value[0].dungeonId).toBe(null);
    expect(parsed.ok && parsed.value[0].dungeonRunKey).toBe(null);
  });

  it("refuse un dungeonRunKey qui n'est pas un sha256 hexadécimal", () => {
    const parsed = parseFightsBody({
      entries: [fightEntry({ dungeonId: 500, dungeonRunKey: 'run-1' })],
    });
    expect(parsed).toEqual({ ok: false, error: expect.stringContaining('dungeonRunKey') });
  });

  it('refuse un dungeonId renseigné sans dungeonRunKey (et inversement)', () => {
    expect(parseFightsBody({ entries: [fightEntry({ dungeonId: 500 })] })).toEqual({
      ok: false,
      error: expect.stringContaining('ensemble'),
    });
    expect(parseFightsBody({ entries: [fightEntry({ dungeonRunKey: KEY_B })] })).toEqual({
      ok: false,
      error: expect.stringContaining('ensemble'),
    });
  });

  it("refuse un clientKey qui n'est pas un sha256 hexadécimal", () => {
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

  describe('ventilation par sort et butin', () => {
    it('accepte la ventilation par sort et par élément', () => {
      const parsed = parseFightsBody({
        entries: [
          fightEntry({
            participants: [
              {
                side: 'ally',
                name: 'Oumbra',
                instanceIndex: 1,
                damage: 1234,
                spells: [
                  { spell: 'Frappe', total: 1000, byElement: { Terre: 800, Feu: 200 } },
                  { spell: 'Piqûre', total: 234, byElement: { Air: 234 } },
                ],
              },
            ],
          }),
        ],
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value[0].participants[0].spells).toEqual([
        { spell: 'Frappe', total: 1000, byElement: { Terre: 800, Feu: 200 } },
        { spell: 'Piqûre', total: 234, byElement: { Air: 234 } },
      ]);
    });

    it("n'impose aucune liste fermée d'éléments (une extension du jeu ne doit rien casser)", () => {
      const parsed = parseFightsBody({
        entries: [
          fightEntry({
            participants: [
              {
                side: 'ally',
                name: 'Oumbra',
                instanceIndex: 1,
                spells: [{ spell: 'X', total: 10, byElement: { ÉlémentInédit: 10 } }],
              },
            ],
          }),
        ],
      });
      expect(parsed.ok && parsed.value[0].participants[0].spells[0].byElement).toEqual({
        ÉlémentInédit: 10,
      });
    });

    it('accepte un participant sans aucun sort (jamais vu jouer)', () => {
      const parsed = parseFightsBody({
        entries: [fightEntry({ participants: [{ side: 'enemy', name: 'Bouftou' }] })],
      });
      expect(parsed.ok && parsed.value[0].participants[0].spells).toEqual([]);
    });

    it('refuse deux ventilations du même sort pour une même instance', () => {
      const parsed = parseFightsBody({
        entries: [
          fightEntry({
            participants: [
              {
                side: 'ally',
                name: 'Oumbra',
                instanceIndex: 1,
                spells: [
                  { spell: 'Frappe', total: 10 },
                  { spell: 'Frappe', total: 20 },
                ],
              },
            ],
          }),
        ],
      });
      expect(parsed).toEqual({ ok: false, error: expect.stringContaining('sort en double') });
    });

    it('accepte le butin du combat (itemId résolu ⇒ itemName forcé à null)', () => {
      const parsed = parseFightsBody({
        entries: [
          fightEntry({
            loot: [
              { itemId: 1234, itemName: 'Laine de Bouftou', quantity: 3 },
              { itemId: null, itemName: 'Objet inconnu du catalogue', quantity: 1 },
            ],
          }),
        ],
      });
      expect(parsed.ok && parsed.value[0].loot).toEqual([
        { lineIndex: 0, itemId: 1234, itemName: null, quantity: 3 },
        { lineIndex: 1, itemId: null, itemName: 'Objet inconnu du catalogue', quantity: 1 },
      ]);
    });

    it('accepte un combat sans butin', () => {
      expect(parseFightsBody({ entries: [fightEntry()] })).toMatchObject({ ok: true });
    });

    it('accepte deux lignes de butin homonymes non résolues, distinguées par lineIndex', () => {
      // Depuis le retrait d'item_name de la clé primaire de fight_loot (nullable désormais, voir
      // server/db/schema.ts), deux objets non résolus de même nom dans un même combat ne sont plus
      // une collision : lineIndex (position dans le lot envoyé) les distingue.
      const parsed = parseFightsBody({
        entries: [
          fightEntry({
            loot: [
              { itemName: 'Poudre', quantity: 1 },
              { itemName: 'Poudre', quantity: 2 },
            ],
          }),
        ],
      });
      expect(parsed.ok && parsed.value[0].loot).toEqual([
        { lineIndex: 0, itemId: null, itemName: 'Poudre', quantity: 1 },
        { lineIndex: 1, itemId: null, itemName: 'Poudre', quantity: 2 },
      ]);
    });

    it("accepte l'XP par participant", () => {
      const parsed = parseFightsBody({
        entries: [
          fightEntry({
            participants: [
              { side: 'ally', name: 'Caliburnus', instanceIndex: 1, xpGained: 7374187 },
              { side: 'enemy', name: 'Bouftou', instanceIndex: 1 },
            ],
          }),
        ],
      });
      expect(parsed.ok && parsed.value[0].participants.map((p) => p.xpGained)).toEqual([
        7374187, 0,
      ]);
    });

    it('refuse une XP de participant négative', () => {
      const parsed = parseFightsBody({
        entries: [
          fightEntry({
            participants: [{ side: 'ally', name: 'Oumbra', instanceIndex: 1, xpGained: -5 }],
          }),
        ],
      });
      expect(parsed).toEqual({
        ok: false,
        error: expect.stringContaining('participant.xpGained'),
      });
    });

    it('refuse une quantité de butin négative', () => {
      const parsed = parseFightsBody({
        entries: [fightEntry({ loot: [{ itemName: 'Poudre', quantity: -1 }] })],
      });
      expect(parsed).toEqual({ ok: false, error: expect.stringContaining('loot.quantity') });
    });
  });
});

describe('parsePurchasesBody', () => {
  it('accepte un achat complet (itemId résolu ⇒ itemName forcé à null)', () => {
    const parsed = parsePurchasesBody({ entries: [purchaseEntry()] });
    expect(parsed.ok && parsed.value[0]).toMatchObject({
      itemName: null,
      quantity: 4,
      totalCost: 340,
      itemId: 1234,
      gameServer: null,
    });
  });

  it('accepte un objet inconnu du catalogue (itemId absent ⇒ itemName conservé)', () => {
    const parsed = parsePurchasesBody({ entries: [purchaseEntry({ itemId: null })] });
    expect(parsed.ok && parsed.value[0]).toMatchObject({ itemId: null, itemName: 'Pain Complet' });
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

  it("refuse un nom d'objet vide quand itemId n'est pas résolu (seule source d'identité restante)", () => {
    expect(
      parsePurchasesBody({ entries: [purchaseEntry({ itemId: null, itemName: '' })] }),
    ).toEqual({
      ok: false,
      error: expect.stringContaining('itemName'),
    });
  });

  it('ignore un itemName invalide quand itemId est déjà résolu (redondant, jamais stocké)', () => {
    const parsed = parsePurchasesBody({ entries: [purchaseEntry({ itemName: '' })] });
    expect(parsed.ok && parsed.value[0]).toMatchObject({ itemId: 1234, itemName: null });
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
