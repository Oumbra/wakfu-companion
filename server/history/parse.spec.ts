import { describe, expect, it } from 'vitest';
import {
  MAX_ELEMENTS_PER_SPELL,
  MAX_HISTORY_BATCH,
  MAX_PAGE_SIZE,
  PG_INT32_MAX,
  echoValue,
  parseFightsBatch,
  parseFightsBody,
  parsePactExtractionsBatch,
  parsePactExtractionsBody,
  encodePageCursor,
  parsePageQuery,
  parsePurchasesBatch,
  parsePurchasesBody,
  parseTradesBatch,
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
      fled: false,
      spells: [],
      heal: 0,
      armor: 0,
      healSpells: [],
      armorSpells: [],
      xpGained: 0,
    });
  });

  it("transporte le soin et l'armure donnés, ventilés par sort", () => {
    const parsed = parseFightsBody({
      entries: [
        fightEntry({
          participants: [
            {
              side: 'ally',
              name: 'Anonyme-Eniripsa2',
              instanceIndex: 1,
              damage: 0,
              heal: 640,
              armor: 9460,
              healSpells: [{ spell: 'Mot Curatif', total: 640, byElement: { Eau: 640 } }],
              armorSpells: [
                { spell: 'Armure Incandescente', total: 9460, byElement: { Inconnu: 9460 } },
              ],
            },
          ],
        }),
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const participant = parsed.value[0].participants[0];
    expect(participant.heal).toBe(640);
    expect(participant.armor).toBe(9460);
    expect(participant.healSpells).toEqual([
      { spell: 'Mot Curatif', total: 640, byElement: { Eau: 640 } },
    ]);
    expect(participant.armorSpells).toEqual([
      { spell: 'Armure Incandescente', total: 9460, byElement: { Inconnu: 9460 } },
    ]);
  });

  it('refuse un soin négatif comme il refuse un dégât négatif', () => {
    const parsed = parseFightsBody({
      entries: [
        fightEntry({
          participants: [{ side: 'ally', name: 'Anonyme-Eniripsa2', instanceIndex: 1, heal: -1 }],
        }),
      ],
    });
    expect(parsed.ok).toBe(false);
  });

  it("refuse deux fois le même sort dans la ventilation d'armure", () => {
    const parsed = parseFightsBody({
      entries: [
        fightEntry({
          participants: [
            {
              side: 'ally',
              name: 'Anonyme-Eniripsa2',
              instanceIndex: 1,
              armorSpells: [
                { spell: 'Bouclier', total: 10, byElement: { Inconnu: 10 } },
                { spell: 'Bouclier', total: 5, byElement: { Inconnu: 5 } },
              ],
            },
          ],
        }),
      ],
    });
    expect(parsed.ok).toBe(false);
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

  it('défaute challengesPassed/challengesFailed à 0 quand absents (0 est une vraie valeur, pas "inconnu")', () => {
    const parsed = parseFightsBody({ entries: [fightEntry()] });
    expect(parsed.ok && parsed.value[0].challengesPassed).toBe(0);
    expect(parsed.ok && parsed.value[0].challengesFailed).toBe(0);
  });

  it('transporte challengesPassed/challengesFailed quand fournis', () => {
    const parsed = parseFightsBody({
      entries: [fightEntry({ challengesPassed: 2, challengesFailed: 1 })],
    });
    expect(parsed.ok && parsed.value[0].challengesPassed).toBe(2);
    expect(parsed.ok && parsed.value[0].challengesFailed).toBe(1);
  });

  it('refuse un challengesPassed négatif ou non entier', () => {
    expect(parseFightsBody({ entries: [fightEntry({ challengesPassed: -1 })] })).toEqual({
      ok: false,
      error: expect.stringContaining('challengesPassed'),
    });
    expect(parseFightsBody({ entries: [fightEntry({ challengesFailed: 1.5 })] })).toEqual({
      ok: false,
      error: expect.stringContaining('challengesFailed'),
    });
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
              { side: 'ally', name: 'Anonyme-Iop1', instanceIndex: 1, xpGained: 7374187 },
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
      value: { limit: 50, before: null, beforeId: null },
    });
  });

  it('lit un curseur before valide', () => {
    const parsed = parsePageQuery(new URLSearchParams('limit=10&before=2026-08-11T10:00:00.000Z'));
    expect(parsed.ok && parsed.value.limit).toBe(10);
    expect(parsed.ok && parsed.value.before?.toISOString()).toBe('2026-08-11T10:00:00.000Z');
  });

  it('lit un curseur composite (date, id) et reste compatible avec l’ancien format', () => {
    const cursor = encodePageCursor(new Date('2026-08-11T10:00:00.000Z'), 42);
    const parsed = parsePageQuery(new URLSearchParams({ before: cursor }));
    expect(parsed.ok && parsed.value.before?.toISOString()).toBe('2026-08-11T10:00:00.000Z');
    expect(parsed.ok && parsed.value.beforeId).toBe(42);
    const legacy = parsePageQuery(new URLSearchParams('before=2026-08-11T10:00:00.000Z'));
    expect(legacy.ok && legacy.value.beforeId).toBeNull();
    expect(parsePageQuery(new URLSearchParams({ before: '2026-08-11T10:00:00.000Z~x' })).ok).toBe(
      false,
    );
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

describe('bornes de sécurité (audit 2026-09-23)', () => {
  const NOW = new Date('2026-09-23T12:00:00.000Z');
  const spell = (byElement: Record<string, unknown>) => ({ spell: 'Sort', total: 1, byElement });
  const withSpell = (byElement: Record<string, unknown>) =>
    fightEntry({
      participants: [{ side: 'ally', name: 'Oumbra', spells: [spell(byElement)] }],
    });

  it('refuse un entier hors Number.MAX_SAFE_INTEGER sur une colonne bigint', () => {
    expect(parseFightsBody({ entries: [fightEntry({ kamasGained: 1e300 })] }, NOW).ok).toBe(false);
    expect(
      parseFightsBody({ entries: [fightEntry({ totalDamage: Number.MAX_SAFE_INTEGER + 1 })] }, NOW)
        .ok,
    ).toBe(false);
    expect(
      parseFightsBody({ entries: [fightEntry({ totalDamage: Number.MAX_SAFE_INTEGER })] }, NOW).ok,
    ).toBe(true);
    expect(parsePurchasesBody({ entries: [purchaseEntry({ totalCost: 1e20 })] }, NOW).ok).toBe(
      false,
    );
  });

  it('refuse un entier au-delà de PG_INT32_MAX sur une colonne integer', () => {
    const big = 2_147_483_648;
    expect(parseFightsBody({ entries: [fightEntry({ turns: big })] }, NOW).ok).toBe(false);
    expect(parseFightsBody({ entries: [fightEntry({ challengesPassed: big })] }, NOW).ok).toBe(
      false,
    );
    expect(parsePurchasesBody({ entries: [purchaseEntry({ itemId: big })] }, NOW).ok).toBe(false);
    expect(
      parseFightsBody({ entries: [fightEntry({ dungeonId: big, dungeonRunKey: KEY_B })] }, NOW).ok,
    ).toBe(false);
    expect(
      parseFightsBody(
        {
          entries: [
            fightEntry({ participants: [{ side: 'enemy', name: 'Bouftou', monsterId: big }] }),
          ],
        },
        NOW,
      ).ok,
    ).toBe(false);
    expect(
      parseFightsBody(
        {
          entries: [
            fightEntry({ participants: [{ side: 'ally', name: 'Oumbra', instanceIndex: big }] }),
          ],
        },
        NOW,
      ).ok,
    ).toBe(false);
  });

  it('borne les dates d’événement entre 2012 et maintenant + 1 jour', () => {
    expect(
      parseFightsBody({ entries: [fightEntry({ startedAt: '1970-01-01T00:00:00.000Z' })] }, NOW).ok,
    ).toBe(false);
    expect(
      parseFightsBody({ entries: [fightEntry({ startedAt: '2026-09-24T11:00:00.000Z' })] }, NOW).ok,
    ).toBe(true);
    expect(
      parseFightsBody({ entries: [fightEntry({ startedAt: '2026-09-25T00:00:00.000Z' })] }, NOW).ok,
    ).toBe(false);
    expect(
      parseTradesBody({ entries: [tradeEntry({ occurredAt: '2011-12-31T23:59:59.000Z' })] }, NOW)
        .ok,
    ).toBe(false);
    expect(
      parsePurchasesBody(
        { entries: [purchaseEntry({ occurredAt: '+275760-09-13T00:00:00.000Z' })] },
        NOW,
      ).ok,
    ).toBe(false);
    expect(
      parsePactExtractionsBody(
        {
          entries: [
            {
              clientKey: KEY_A,
              occurredAt: '2001-01-01T00:00:00.000Z',
              items: [{ itemId: 1, quantity: 1 }],
            },
          ],
        },
        NOW,
      ).ok,
    ).toBe(false);
  });

  it('borne le curseur before de la même façon', () => {
    expect(parsePageQuery(new URLSearchParams('before=1900-01-01T00:00:00Z'), NOW).ok).toBe(false);
    expect(parsePageQuery(new URLSearchParams('before=2030-01-01T00:00:00Z'), NOW).ok).toBe(false);
    expect(parsePageQuery(new URLSearchParams('before=2026-09-01T00:00:00Z'), NOW).ok).toBe(true);
  });

  it(`borne byElement à ${MAX_ELEMENTS_PER_SPELL} éléments et refuse les clés de prototype`, () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_ELEMENTS_PER_SPELL + 1 }, (_, i) => [`E${i}`, 1]),
    );
    const max = Object.fromEntries(
      Array.from({ length: MAX_ELEMENTS_PER_SPELL }, (_, i) => [`E${i}`, 1]),
    );
    expect(parseFightsBody({ entries: [withSpell(many)] }, NOW).ok).toBe(false);
    expect(parseFightsBody({ entries: [withSpell(max)] }, NOW).ok).toBe(true);
    const proto = JSON.parse('{"__proto__": 3}') as Record<string, unknown>;
    expect(parseFightsBody({ entries: [withSpell(proto)] }, NOW).ok).toBe(false);
    expect(parseFightsBody({ entries: [withSpell({ constructor: 3 })] }, NOW).ok).toBe(false);
  });

  it('borne la forme de gameServer (code court en minuscules)', () => {
    expect(parseFightsBody({ entries: [fightEntry({ gameServer: 'ogrest' })] }, NOW).ok).toBe(true);
    expect(parseFightsBody({ entries: [fightEntry({ gameServer: 'Ogrest' })] }, NOW).ok).toBe(
      false,
    );
    expect(parseFightsBody({ entries: [fightEntry({ gameServer: 'x'.repeat(33) })] }, NOW).ok).toBe(
      false,
    );
  });

  it('expose PG_INT32_MAX à la valeur Postgres', () => {
    expect(PG_INT32_MAX).toBe(2 ** 31 - 1);
  });
});

/**
 * Correctif du 2026-09-23 (régression en production) : validation PAR ENTRÉE. Une entrée invalide
 * est ignorée et signalée, le reste du lot passe ; seul un corps globalement malformé est refusé.
 */
describe('parse*Batch — entrées invalides ignorées, lot valide accepté', () => {
  const NOW_BATCH = new Date('2026-09-23T12:00:00Z');

  it('combat restauré daté de 1970 : ignoré, les autres combats du lot passent', () => {
    const parsed = parseFightsBatch(
      {
        entries: [
          fightEntry({ clientKey: KEY_A }),
          fightEntry({ clientKey: KEY_B, startedAt: '1970-01-01T00:00:00.000Z' }),
          fightEntry({ clientKey: 'c'.repeat(64) }),
        ],
      },
      NOW_BATCH,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.entries.map((f) => f.clientKey)).toEqual([KEY_A, 'c'.repeat(64)]);
    expect(parsed.value.indices).toEqual([0, 2]);
    expect(parsed.value.rejected).toEqual([
      { index: 1, clientKey: KEY_B, error: expect.stringContaining('antérieur à 2012') },
    ]);
  });

  it('non-régression : un lot entièrement valide passe tel quel, sans rejet', () => {
    const parsed = parseFightsBatch(
      { entries: [fightEntry({ clientKey: KEY_A }), fightEntry({ clientKey: KEY_B })] },
      NOW_BATCH,
    );
    expect(parsed).toMatchObject({ ok: true, value: { indices: [0, 1], rejected: [] } });
  });

  it('entrée non objet ou clientKey illisible : ignorée, sans clientKey dans le rejet', () => {
    const parsed = parsePurchasesBatch(
      { entries: [42, purchaseEntry({ clientKey: 'pas-un-hash' }), purchaseEntry()] },
      NOW_BATCH,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.entries).toHaveLength(1);
    expect(parsed.value.indices).toEqual([2]);
    expect(parsed.value.rejected.map((r) => r.index)).toEqual([0, 1]);
    expect(parsed.value.rejected.every((r) => r.clientKey === undefined)).toBe(true);
  });

  it('clientKey en double : la PREMIÈRE occurrence est gardée, les suivantes ignorées', () => {
    const parsed = parseTradesBatch(
      {
        entries: [
          tradeEntry({ peerName: 'Premier' }),
          tradeEntry({ peerName: 'Second' }),
          tradeEntry({ clientKey: KEY_B }),
        ],
      },
      NOW_BATCH,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.entries.map((t) => t.peerName)).toEqual(['Premier', 'Autre']);
    expect(parsed.value.rejected).toEqual([
      { index: 1, clientKey: KEY_A, error: 'clientKey en double dans le lot' },
    ]);
  });

  it('extractions de pacte : même sémantique par entrée', () => {
    const parsed = parsePactExtractionsBatch(
      {
        entries: [
          { clientKey: KEY_A, occurredAt: '2026-09-01T10:00:00Z', items: [] },
          { clientKey: KEY_B, occurredAt: '2099-01-01T00:00:00Z', items: [] },
        ],
      },
      NOW_BATCH,
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: { indices: [0], rejected: [{ index: 1, clientKey: KEY_B }] },
    });
  });

  it('corps globalement malformé : toujours refusé (400)', () => {
    expect(parseFightsBatch({}, NOW_BATCH).ok).toBe(false);
    expect(parseFightsBatch({ entries: 'x' }, NOW_BATCH).ok).toBe(false);
    expect(parseFightsBatch(null, NOW_BATCH).ok).toBe(false);
    const tooMany = Array.from({ length: MAX_HISTORY_BATCH + 1 }, () => fightEntry());
    expect(parseFightsBatch({ entries: tooMany }, NOW_BATCH).ok).toBe(false);
  });

  it('lot vide : accepté, rien à écrire', () => {
    expect(parseFightsBatch({ entries: [] }, NOW_BATCH)).toEqual({
      ok: true,
      value: { entries: [], indices: [], rejected: [] },
    });
  });

  it('caractère NUL (refusé par Postgres, 500 sinon) : entrée ignorée', () => {
    const parsed = parseFightsBatch(
      {
        entries: [
          fightEntry({
            participants: [{ side: 'ally', name: 'Oum\u0000bra', instanceIndex: 1 }],
          }),
          fightEntry({
            clientKey: KEY_B,
            participants: [
              {
                side: 'ally',
                name: 'Oumbra',
                instanceIndex: 1,
                spells: [{ spell: 'Coup', total: 1, byElement: { 'Fe\u0000u': 1 } }],
              },
            ],
          }),
        ],
      },
      NOW_BATCH,
    );
    expect(parsed).toMatchObject({ ok: true, value: { entries: [], indices: [] } });
    if (!parsed.ok) return;
    expect(parsed.value.rejected.map((r) => r.index)).toEqual([0, 1]);
  });

  it('même (nom, instance) dans les deux camps : entrée ignorée (clé primaire sans camp)', () => {
    const parsed = parseFightsBatch(
      {
        entries: [
          fightEntry({
            participants: [
              { side: 'ally', name: 'Bouftou', instanceIndex: 1 },
              { side: 'enemy', name: 'Bouftou', instanceIndex: 1 },
            ],
          }),
        ],
      },
      NOW_BATCH,
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: { entries: [], rejected: [{ index: 0, error: expect.stringContaining('double') }] },
    });
  });

  it('non-régression : homonymes numérotés sur les deux camps (web : 1, 2 ; overlay : 0, 1)', () => {
    for (const [first, second] of [
      [1, 2],
      [0, 1],
    ]) {
      const parsed = parseFightsBody(
        {
          entries: [
            fightEntry({
              participants: [
                { side: 'ally', name: 'Bouftou', instanceIndex: first },
                { side: 'enemy', name: 'Bouftou', instanceIndex: second },
              ],
            }),
          ],
        },
        NOW_BATCH,
      );
      expect(parsed.ok).toBe(true);
    }
  });

  it('message d’erreur : jamais la valeur brute au-delà de 64 caractères', () => {
    const huge = 'x'.repeat(10_000);
    const parsed = parseFightsBatch({ entries: [fightEntry({ durationMs: huge })] }, NOW_BATCH);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.rejected[0].error.length).toBeLessThan(120);
    expect(echoValue(huge)).toHaveLength(65);
    expect(echoValue('court')).toBe('court');
  });
});
