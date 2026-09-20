import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
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
