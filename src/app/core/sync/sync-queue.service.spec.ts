import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientService, type ApiResult } from '../api/api-client.service';
import { PersistenceService } from '../services/persistence.service';
import type { HistoryEvent } from './history-event.model';
import { SyncQueueService } from './sync-queue.service';

/**
 * Cloisonnement de la file par compte (écart 4.1 de `docs/analyse-rgpd.md`) :
 * le magasin IndexedDB étant unique pour le navigateur, une entrée laissée par
 * un compte ne doit jamais partir sous un autre, et une suppression de compte
 * doit l'effacer du disque.
 *
 * IndexedDB n'existe pas dans cet environnement : le magasin est remplacé par
 * une `Map` en mémoire branchée sur les trois méthodes que la file utilise.
 */

interface SentBatch {
  path: string;
  entries: { clientKey: string }[];
}

function fakeEvent(uid: string, signature: string): HistoryEvent {
  return {
    id: `purchase:${signature}`,
    uid,
    kind: 'purchase',
    signature,
    payload: { time: '12:00:00,000', item: signature, quantity: 1, price: 1 } as never,
    queuedAt: 0,
    attempts: 0,
  };
}

describe('SyncQueueService — cloisonnement par compte', () => {
  let disk: Map<string, HistoryEvent>;
  /** Toutes les entrées passées à `putSyncQueueEntries`, dans l'ordre. */
  let written: HistoryEvent[];
  let sent: SentBatch[];
  let queue: SyncQueueService;

  beforeEach(() => {
    disk = new Map();
    written = [];
    sent = [];
    const api: Pick<ApiClientService, 'requestJson'> = {
      async requestJson<T>(path: string, init?: { body?: unknown }): Promise<ApiResult<T>> {
        const entries = (init?.body as { entries: { clientKey: string }[] }).entries;
        sent.push({ path, entries });
        return { ok: true, data: { accepted: [], inserted: entries.length } as T };
      },
    };
    TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });
    const persistence = TestBed.inject(PersistenceService);
    persistence.getSyncQueue = async <T>() => [...disk.values()] as T[];
    persistence.putSyncQueueEntries = async (entries) => {
      for (const entry of entries) {
        disk.set(entry.id, entry as HistoryEvent);
        written.push(entry as HistoryEvent);
      }
    };
    persistence.deleteSyncQueueEntries = async (ids) => {
      for (const id of ids) disk.delete(id);
    };
    queue = TestBed.inject(SyncQueueService);
  });

  it("n'envoie jamais sous B une entrée laissée par A, et l'efface du disque", async () => {
    disk.set('purchase:a1', fakeEvent('compte-A', 'a1'));
    disk.set('purchase:a2', fakeEvent('compte-A', 'a2'));

    await queue.activate('compte-B');

    expect(sent).toEqual([]);
    expect(queue.pendingCount()).toBe(0);
    expect(disk.size).toBe(0);
  });

  it("ignore et efface une entrée d'avant l'ajout de `uid` (propriétaire inconnu)", async () => {
    const legacy = fakeEvent('', 'legacy');
    delete (legacy as Partial<HistoryEvent>).uid;
    disk.set(legacy.id, legacy);

    await queue.activate('compte-A');

    expect(sent).toEqual([]);
    expect(disk.size).toBe(0);
  });

  it('recharge et envoie les entrées du compte qui se reconnecte', async () => {
    disk.set('purchase:a1', fakeEvent('compte-A', 'a1'));
    disk.set('purchase:b1', fakeEvent('compte-B', 'b1'));

    await queue.activate('compte-A');

    expect(sent).toHaveLength(1);
    expect(sent[0].entries).toHaveLength(1);
    // Envoyée puis oubliée ; celle de B, elle, a été effacée sans être envoyée.
    expect(disk.size).toBe(0);
  });

  it("estampille chaque entrée mise en file avec l'uid du compte courant", async () => {
    await queue.activate('compte-A');
    queue.enqueue({
      id: 'purchase:x',
      kind: 'purchase',
      signature: 'x',
      payload: { time: '12:00:00,000', item: 'x', quantity: 1, price: 1 } as never,
    });
    await queue.flush();

    expect(sent).toHaveLength(1);
    // La persistance précède l'envoi : l'entrée a transité par le disque avec son uid.
    expect(written.map((entry) => [entry.id, entry.uid])).toEqual([['purchase:x', 'compte-A']]);
    expect(disk.size).toBe(0);
  });

  it('purge() efface du disque les entrées du compte supprimé, et seulement celles-là', async () => {
    disk.set('purchase:a1', fakeEvent('compte-A', 'a1'));
    // Réseau coupé : rien ne part, la file reste pleine.
    TestBed.inject(ApiClientService).requestJson = async <T>(): Promise<ApiResult<T>> => ({
      ok: false,
      error: { kind: 'network' },
    });
    await queue.activate('compte-A');
    expect(queue.pendingCount()).toBe(1);
    // Entrée d'un autre compte arrivée sur le disque après l'activation (un
    // autre onglet, par exemple) : la purge de A ne doit pas la toucher.
    disk.set('purchase:b1', fakeEvent('compte-B', 'b1'));

    await queue.purge();

    expect(queue.isActive()).toBe(false);
    expect(queue.pendingCount()).toBe(0);
    expect([...disk.keys()]).toEqual(['purchase:b1']);
  });
});

describe('SyncQueueService — limite de débit (HTTP 429)', () => {
  let disk: Map<string, HistoryEvent>;
  let calls: number;
  let respond: () => ApiResult<unknown>;
  let queue: SyncQueueService;

  beforeEach(() => {
    disk = new Map();
    calls = 0;
    respond = () => ({ ok: false, error: { kind: 'http', status: 429, retryAfterMs: 60_000 } });
    const api: Pick<ApiClientService, 'requestJson'> = {
      async requestJson<T>(): Promise<ApiResult<T>> {
        calls += 1;
        return respond() as ApiResult<T>;
      },
    };
    TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });
    const persistence = TestBed.inject(PersistenceService);
    persistence.getSyncQueue = async <T>() => [...disk.values()] as T[];
    persistence.putSyncQueueEntries = async (entries) => {
      for (const entry of entries) disk.set(entry.id, entry as HistoryEvent);
    };
    persistence.deleteSyncQueueEntries = async (ids) => {
      for (const id of ids) disk.delete(id);
    };
    queue = TestBed.inject(SyncQueueService);
  });

  it('garde les entrées en file et respecte Retry-After pour tout nouveau flush', async () => {
    disk.set('purchase:x1', fakeEvent('compte-A', 'x1'));
    await queue.activate('compte-A');

    expect(calls).toBe(1);
    expect(queue.pendingCount()).toBe(1);
    expect(disk.has('purchase:x1')).toBe(true);
    expect(queue.state()).toBe('error');

    // Un déclencheur externe (retour réseau, bouton « Synchroniser maintenant ») ne doit pas
    // contourner le délai imposé par le serveur.
    await queue.flush();
    await queue.flush();
    expect(calls).toBe(1);
    expect(queue.pendingCount()).toBe(1);

    // Plusieurs 429 d'affilée ne comptent jamais comme un refus de la charge utile.
    expect(disk.get('purchase:x1')?.attempts).toBe(0);
    queue.deactivate();
  });
});

describe('SyncQueueService — quota d’historique atteint (403 history_quota_exceeded)', () => {
  let disk: Map<string, HistoryEvent>;
  let calls: number;
  let queue: SyncQueueService;

  beforeEach(() => {
    disk = new Map();
    calls = 0;
    const api: Pick<ApiClientService, 'requestJson'> = {
      async requestJson<T>(): Promise<ApiResult<T>> {
        calls += 1;
        return { ok: false, error: { kind: 'http', status: 403, code: 'history_quota_exceeded' } };
      },
    };
    TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });
    const persistence = TestBed.inject(PersistenceService);
    persistence.getSyncQueue = async <T>() => [...disk.values()] as T[];
    persistence.putSyncQueueEntries = async (entries) => {
      for (const entry of entries) disk.set(entry.id, entry as HistoryEvent);
    };
    persistence.deleteSyncQueueEntries = async (ids) => {
      for (const id of ids) disk.delete(id);
    };
    queue = TestBed.inject(SyncQueueService);
  });

  it("n'envoie plus rien automatiquement et garde les éléments sans les compter comme tentatives", async () => {
    disk.set('purchase:q1', fakeEvent('compte-A', 'q1'));
    await queue.activate('compte-A');
    expect(calls).toBe(1);
    expect(queue.quotaExceeded()).toBe(true);

    for (let i = 0; i < 15; i++) await queue.flush();
    expect(calls).toBe(1);
    expect(queue.pendingCount()).toBe(1);
    expect(disk.get('purchase:q1')?.attempts ?? 0).toBe(0);

    // Un envoi manuel retente une seule fois.
    await queue.flush({ manual: true });
    expect(calls).toBe(2);
    expect(disk.has('purchase:q1')).toBe(true);
    queue.deactivate();
  });
});

/**
 * Découpage des lots (audit 2026-09-23) : un lot de 50 combats contenant des combats de brèche
 * pouvait dépasser `MAX_PAYLOAD_BYTES` (1 Mio) côté serveur → 413 → lot compté comme refusé puis
 * abandonné après `MAX_ATTEMPTS` (combats perdus). Et prise en charge du champ `rejected` d'une
 * réponse 200 partielle.
 */
describe('SyncQueueService — découpage par taille, 413 et rejets partiels', () => {
  type Handler = (entries: { clientKey: string; blob?: string }[]) => ApiResult<unknown>;
  let sent: { path: string; entries: { clientKey: string; blob?: string }[]; bytes: number }[];
  let handler: Handler;
  let queue: SyncQueueService;
  let warn: ReturnType<typeof vi.spyOn>;

  const ok = (): ApiResult<unknown> => ({ ok: true, data: { accepted: [], inserted: 0 } });

  function fight(id: string, blobBytes: number, extra: Partial<HistoryEvent> = {}): void {
    queue.enqueue({
      id: `fight:${id}`,
      kind: 'fight',
      signature: id,
      payload: { blob: 'x'.repeat(blobBytes) } as never,
      ...extra,
    });
  }

  beforeEach(async () => {
    sent = [];
    handler = ok;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const api: Pick<ApiClientService, 'requestJson'> = {
      async requestJson<T>(path: string, init?: { body?: unknown }): Promise<ApiResult<T>> {
        const entries = (init?.body as { entries: { clientKey: string; blob?: string }[] }).entries;
        const bytes = new TextEncoder().encode(JSON.stringify(init?.body)).length;
        sent.push({ path, entries, bytes });
        return handler(entries) as ApiResult<T>;
      },
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });
    const persistence = TestBed.inject(PersistenceService);
    persistence.getSyncQueue = async <T>() => [] as T[];
    persistence.putSyncQueueEntries = async () => undefined;
    persistence.deleteSyncQueueEntries = async () => undefined;
    queue = TestBed.inject(SyncQueueService);
    await queue.activate('compte-A');
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('découpe un lot trop lourd en plusieurs envois sous 900 Kio, sans rien perdre', async () => {
    for (let i = 0; i < 50; i++) fight(`f${i}`, 40_000); // 50 × ~40 Ko ≈ 2 Mo
    await queue.flush();

    expect(sent.length).toBeGreaterThan(1);
    for (const batch of sent) expect(batch.bytes).toBeLessThanOrEqual(900 * 1024);
    expect(sent.flatMap((b) => b.entries)).toHaveLength(50);
    expect(queue.pendingCount()).toBe(0);
  });

  it('écarte définitivement un combat seul plus gros que la limite, sans bloquer les autres', async () => {
    fight('petit-1', 100);
    fight('geant', 1_000_000);
    fight('petit-2', 100);
    await queue.flush();

    expect(sent.flatMap((b) => b.entries)).toHaveLength(2);
    expect(queue.pendingCount()).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it('sur 413, redivise le lot au lieu de compter une tentative', async () => {
    // Serveur plus strict que prévu : refuse tout corps de plus de 2 entrées.
    handler = (entries) =>
      entries.length > 2 ? { ok: false, error: { kind: 'http', status: 413 } } : ok();
    for (let i = 0; i < 5; i++) fight(`f${i}`, 10);
    await queue.flush();

    const accepted = sent.filter((b) => b.entries.length <= 2).flatMap((b) => b.entries);
    expect(accepted.map((e) => e.blob?.length)).toHaveLength(5);
    expect(queue.pendingCount()).toBe(0);
    expect(queue.state()).toBe('idle');
  });

  it('sur 413 pour une entrée seule, l’écarte et continue', async () => {
    handler = (entries) =>
      entries.some((e) => (e.blob?.length ?? 0) > 50)
        ? { ok: false, error: { kind: 'http', status: 413 } }
        : ok();
    fight('a', 10);
    fight('refuse', 100);
    fight('b', 10);
    await queue.flush();

    expect(queue.pendingCount()).toBe(0);
    expect(queue.state()).toBe('idle');
    const lastBatches = sent.filter((b) => b.entries.every((e) => (e.blob?.length ?? 0) <= 50));
    expect(lastBatches.flatMap((b) => b.entries)).toHaveLength(2);
  });

  it('retire les entrées listées dans `rejected` (et confirme les autres)', async () => {
    handler = () => ({
      ok: true,
      data: { accepted: [], inserted: 1, rejected: [{ index: 1, error: 'participant invalide' }] },
    });
    fight('a', 10);
    fight('b', 10);
    await queue.flush();

    expect(sent).toHaveLength(1);
    expect(queue.pendingCount()).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('participant invalide'),
      sent[0].entries[1].clientKey,
    );
  });

  it('reste compatible avec une réponse sans `rejected` (ou vide)', async () => {
    handler = () => ({ ok: true, data: undefined });
    fight('a', 10);
    await queue.flush();
    expect(queue.pendingCount()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('utilise tel quel un clientKey fourni, et n’envoie jamais deux fois la même clé dans un lot', async () => {
    fight('archive', 10, { clientKey: 'cle-serveur' });
    fight('autre', 10);
    fight('archive-bis', 20, { clientKey: 'cle-serveur' });
    await queue.flush();

    for (const batch of sent) {
      const keys = batch.entries.map((e) => e.clientKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
    const all = sent.flatMap((b) => b.entries);
    expect(all.filter((e) => e.clientKey === 'cle-serveur').map((e) => e.blob?.length)).toEqual([
      10, 20,
    ]);
    expect(queue.pendingCount()).toBe(0);
  });
});

describe('SyncQueueService — renvois d’archive hérités (avant correctif)', () => {
  it('écarte au rechargement un renvoi de combat signé avec un id d’archive négatif', async () => {
    const disk = new Map<string, HistoryEvent>();
    const sent: string[] = [];
    const legacy: HistoryEvent = {
      id: 'fight:12:00:00,000|-3|won|testeur#1',
      uid: 'compte-A',
      kind: 'fight',
      signature: '12:00:00,000|-3|won|testeur#1',
      payload: {} as never,
      queuedAt: 0,
      attempts: 0,
    };
    const normal: HistoryEvent = {
      ...legacy,
      id: 'fight:12:00:00,000|4242|won|testeur#1',
      signature: '12:00:00,000|4242|won|testeur#1',
    };
    disk.set(legacy.id, legacy);
    disk.set(normal.id, normal);
    const api: Pick<ApiClientService, 'requestJson'> = {
      async requestJson<T>(_path: string, init?: { body?: unknown }): Promise<ApiResult<T>> {
        for (const e of (init?.body as { entries: { clientKey: string }[] }).entries)
          sent.push(e.clientKey);
        return { ok: true, data: undefined as T };
      },
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });
    const persistence = TestBed.inject(PersistenceService);
    persistence.getSyncQueue = async <T>() => [...disk.values()] as T[];
    persistence.putSyncQueueEntries = async () => undefined;
    persistence.deleteSyncQueueEntries = async (ids) => {
      for (const id of ids) disk.delete(id);
    };
    await TestBed.inject(SyncQueueService).activate('compte-A');

    expect(sent).toHaveLength(1);
    expect(disk.size).toBe(0);
  });
});
