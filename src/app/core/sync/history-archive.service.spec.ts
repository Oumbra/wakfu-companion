import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientService, type ApiResult } from '../api/api-client.service';
import { LogFileAccessService } from '../services/log-file-access.service';
import { StatsStoreService } from '../services/stats-store.service';
import { HistoryArchiveService } from './history-archive.service';
import { PersistenceService } from '../services/persistence.service';
import { SyncQueueService } from './sync-queue.service';

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

/**
 * Régression du bug réel constaté le 2026-09-05 (remonté par l'utilisateur, comparaison
 * claude-dev.wakfu-companion.com/overlay vs wakfu-companion.com/lecture directe du log) : un combat
 * synchronisé par l'overlay pouvait porter plusieurs lignes `fight_loot` pour le même objet — un
 * ramassage par ligne de log, jamais fusionné avant envoi (corrigé côté overlay le même jour, voir
 * `overlay-engine::session::SessionState::apply`) — alors que la lecture directe du log fusionne
 * déjà ses propres ramassages en mémoire. `HistoryArchiveService.toFightRecord` doit fusionner ces
 * lignes à la lecture (`mergeLootRowsByIdentity`, même mécanisme que `SessionRecapComponent`) pour
 * que les combats DÉJÀ synchronisés non fusionnés s'affichent quand même correctement, sans backfill
 * de la base.
 */
describe('HistoryArchiveService — fusion du butin dupliqué (bug overlay du 2026-09-05)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('plusieurs lignes de butin du même objet dans un combat archivé sont fusionnées en une seule', async () => {
    TestBed.configureTestingModule({});
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
                clientKey: 'test-client-key-loot',
                startedAt: new Date(0).toISOString(),
                durationMs: 1000,
                won: true,
                turns: 1,
                totalDamage: 0,
                xpGained: 0,
                kamasGained: 0,
                gameServer: null,
                participants: [],
                // Trois ramassages bruts du même objet, comme les stockerait un combat synchronisé
                // par l'overlay avant son correctif du 2026-09-05.
                loot: [
                  { itemId: null, itemName: 'Eclats', quantity: 48 },
                  { itemId: null, itemName: 'Eclats', quantity: 48 },
                  { itemId: null, itemName: 'Eclats', quantity: 48 },
                ],
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

    const archive = TestBed.inject(HistoryArchiveService);
    await archive.loadMore('fight');

    const [fight] = archive.fights();
    expect(fight.loot).toHaveLength(1);
    expect(fight.loot[0].name).toBe('Eclats');
    expect(fight.loot[0].quantity).toBe(144);
  });
});

/**
 * Régression du bug réel remonté par l'utilisateur le 2026-09-15 (captures comparant le même
 * combat affiché depuis la lecture directe du log et depuis l'archive alimentée par l'overlay) :
 * `toFightRecord` ne gardait, pour le soin et l'armure, que les lignes non nulles — alors que la
 * copie de session du même combat porte TOUJOURS une ligne par participant, à zéro comprise (voir
 * `StatsStoreService.finalizeFight`). Basculer Dégâts → Soin → Armure faisait donc apparaître et
 * disparaître des combattants selon la provenance du combat affiché.
 */
describe('HistoryArchiveService — roster complet sur les trois grandeurs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('un participant sans soin ni armure garde une ligne à zéro, comme pour les dégâts', async () => {
    const participant = (
      name: string,
      side: 'ally' | 'enemy',
      damage: number,
      heal: number,
      armor: number,
    ) => ({
      side,
      name,
      monsterId: null,
      instanceIndex: 1,
      className: null,
      damage,
      defeated: false,
      fled: false,
      spells: [],
      heal,
      armor,
      healSpells: [],
      armorSpells: [],
      xpGained: 0,
    });
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
                clientKey: 'test-client-key-roster',
                startedAt: new Date(0).toISOString(),
                durationMs: 1000,
                won: true,
                turns: 1,
                totalDamage: 110,
                xpGained: 0,
                kamasGained: 0,
                gameServer: null,
                participants: [
                  // Un soigneur, un allié qui n'a fait que taper, et un ennemi inerte : les deux
                  // derniers ne doivent pas s'évaporer des onglets Soin/Armure.
                  participant('Anonyme-Huppermage2', 'ally', 100, 6038, 7041),
                  participant('Oumbra', 'ally', 10, 0, 0),
                  participant('Sac à patates', 'enemy', 0, 0, 0),
                ],
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

    const archive = TestBed.inject(HistoryArchiveService);
    await archive.loadMore('fight');

    const [fight] = archive.fights();
    const names = (rows: readonly { name: string }[]) => rows.map((row) => row.name).sort();
    expect(names(fight.healRows)).toEqual(names(fight.rows));
    expect(names(fight.armorRows)).toEqual(names(fight.rows));
    expect(fight.healRows.find((row) => row.name === 'Oumbra')?.total).toBe(0);
    expect(fight.armorRows.find((row) => row.name === 'Sac à patates')?.total).toBe(0);
    // Les lignes non nulles restent en tête (tri par total décroissant, inchangé).
    expect(fight.healRows[0].name).toBe('Anonyme-Huppermage2');
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

/**
 * Régression (audit 2026-09-23) : une correction de butin faite depuis un combat ARCHIVÉ renvoyait
 * le combat avec `FightRecord.id = archiveId(index)` (négatif, dépendant de la position dans la page
 * chargée) comme `fightId` de sa signature → `clientKey` inédit → le serveur insérait un NOUVEAU
 * combat au lieu de corriger l'existant (et un autre à chaque rechargement où l'index bougeait).
 * Le renvoi doit réutiliser le `clientKey` d'origine renvoyé par `GET /history/fights`.
 */
describe('HistoryArchiveService — renvoi d’une correction depuis l’archive', () => {
  interface Sent {
    path: string;
    entries: { clientKey: string; fightId?: number | null; loot?: unknown[] }[];
  }

  function archivedFight(clientKey: string, time: string) {
    return {
      clientKey,
      startedAt: time,
      durationMs: 60_000,
      won: true,
      turns: 3,
      totalDamage: 100,
      xpGained: 0,
      kamasGained: 0,
      gameServer: null,
      challengesPassed: 0,
      challengesFailed: 0,
      participants: [
        {
          side: 'ally' as const,
          name: 'Testeur',
          instanceIndex: 1,
          className: null,
          damage: 100,
          defeated: false,
          fled: false,
          spells: null,
          heal: 0,
          armor: 0,
          healSpells: null,
          armorSpells: null,
          xpGained: 0,
        },
      ],
      loot: [{ itemId: null, itemName: 'Objet de test inconnu', quantity: 2 }],
    };
  }

  async function setup(pages: unknown[][]): Promise<{
    archive: HistoryArchiveService;
    queue: SyncQueueService;
    sent: Sent[];
  }> {
    localStorage.clear();
    const sent: Sent[] = [];
    let call = 0;
    const api: Partial<ApiClientService> = {
      setUnauthorizedHandler: () => undefined,
      getJson: async <T>(path: string) => {
        if (!path.startsWith('/history/fights')) {
          return { ok: false, error: { kind: 'offline' } } as ApiResult<T>;
        }
        const entries = pages[Math.min(call++, pages.length - 1)];
        return { ok: true, data: { entries, nextBefore: null } as T };
      },
      requestJson: async <T>(path: string, init?: { body?: unknown }) => {
        const entries = (init?.body as { entries: Sent['entries'] }).entries;
        sent.push({ path, entries });
        return {
          ok: true,
          data: { accepted: entries.map((e) => e.clientKey), inserted: 0 } as T,
        } as ApiResult<T>;
      },
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });
    const persistence = TestBed.inject(PersistenceService);
    persistence.getSyncQueue = async <T>() => [] as T[];
    persistence.putSyncQueueEntries = async () => undefined;
    persistence.deleteSyncQueueEntries = async () => undefined;
    const queue = TestBed.inject(SyncQueueService);
    await queue.activate('compte-test');
    return { archive: TestBed.inject(HistoryArchiveService), queue, sent };
  }

  it('réutilise le clientKey d’origine (jamais un fightId négatif) pour une correction de butin', async () => {
    const target = archivedFight('cle-origine-du-combat', '2026-09-20T10:00:00.000Z');
    const { archive, queue, sent } = await setup([[target]]);
    await archive.loadMore('fight');
    const fight = archive.fights()[0];
    expect(fight.id).toBeLessThan(0);

    archive.reassignLootItem(fight, 'Objet de test inconnu', null, 2, 12345);
    await queue.flush();

    const fights = sent.filter((s) => s.path === '/history/fights').flatMap((s) => s.entries);
    expect(fights).toHaveLength(1);
    expect(fights[0].clientKey).toBe('cle-origine-du-combat');
    expect(fights[0].fightId).toBeNull();
    expect(fights[0].loot).toEqual([{ itemId: 12345, itemName: null, quantity: 2 }]);
  });

  it('le même combat corrigé depuis une position différente de l’archive garde la même clé', async () => {
    const other = archivedFight('cle-autre-combat', '2026-09-21T10:00:00.000Z');
    const target = archivedFight('cle-origine-du-combat', '2026-09-20T10:00:00.000Z');
    const keys: string[] = [];
    for (const page of [[target], [other, target]]) {
      const { archive, queue, sent } = await setup([page]);
      await archive.loadMore('fight');
      const fight = archive
        .fights()
        .find((f) => f.fullTimestampMs === Date.parse(target.startedAt))!;
      archive.reassignLootItem(fight, 'Objet de test inconnu', null, 2, 12345);
      await queue.flush();
      keys.push(...sent.flatMap((s) => s.entries.map((e) => e.clientKey)));
    }
    expect(keys).toEqual(['cle-origine-du-combat', 'cle-origine-du-combat']);
  });

  it('ne renvoie pas un combat dont le butin a été fusionné à la lecture (positions ≠ line_index)', async () => {
    const target = {
      ...archivedFight('cle-origine-du-combat', '2026-09-20T10:00:00.000Z'),
      loot: [
        { itemId: null, itemName: 'Objet de test inconnu', quantity: 1 },
        { itemId: null, itemName: 'Autre objet inconnu', quantity: 1 },
        { itemId: null, itemName: 'Objet de test inconnu', quantity: 1 },
      ],
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { archive, queue, sent } = await setup([[target]]);
      await archive.loadMore('fight');
      const fight = archive.fights()[0];
      expect(fight.loot).toHaveLength(2);
      archive.reassignLootItem(fight, 'Objet de test inconnu', null, 2, 12345);
      await queue.flush();
      expect(sent).toEqual([]);
      // La correction reste visible localement.
      expect(archive.fights()[0].loot.some((row) => row.catalogId === 12345)).toBe(true);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
