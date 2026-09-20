import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ApiClientService, type ApiResult } from '../api/api-client.service';
import { AccountExportService, type AccountExportServerPart } from './account-export.service';

const SERVER_PART: AccountExportServerPart = {
  exportedAt: '2026-09-20T18:00:00.000Z',
  user: {
    id: 'u1',
    email: 'a@b.c',
    displayName: 'A',
    createdAt: '2026-08-01T00:00:00.000Z',
    lastSeenAt: '2026-09-20T17:00:00.000Z',
  },
  identities: [
    {
      provider: 'discord',
      providerUid: '42',
      email: 'a@b.c',
      linkedAt: '2026-08-01T00:00:00.000Z',
    },
  ],
  sessions: [],
  settings: { profile: { value: { name: 'A' }, updatedAt: '2026-09-01T00:00:00.000Z' } },
};

/** Faux serveur : `/auth/export` fixe, et un historique paginé dont la taille par type est donnée —
 * `limit` respecté, `nextBefore` = `null` sur la dernière page, comme les vraies routes. */
function setup(counts: Record<string, number>, failOn?: string) {
  const calls: string[] = [];
  const api: Partial<ApiClientService> = {
    setUnauthorizedHandler: () => undefined,
    getJson: async <T>(path: string) => {
      calls.push(path);
      if (failOn && path.startsWith(failOn)) {
        return { ok: false, error: { kind: 'network' } } as ApiResult<T>;
      }
      if (path === '/auth/export') return { ok: true, data: SERVER_PART } as ApiResult<T>;
      const url = new URL(path, 'http://x');
      const total = counts[url.pathname] ?? 0;
      const limit = Number(url.searchParams.get('limit'));
      const before = url.searchParams.get('before');
      // Curseur = index (en texte) du premier élément non encore servi.
      const start = before ? Number(before) : 0;
      const end = Math.min(start + limit, total);
      const entries = Array.from({ length: end - start }, (_, i) => ({ n: start + i }));
      const nextBefore = entries.length === limit && end < total ? String(end) : null;
      return { ok: true, data: { entries, nextBefore } } as ApiResult<T>;
    },
  };
  TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: api }] });
  return { service: TestBed.inject(AccountExportService), calls };
}

describe('AccountExportService', () => {
  it('compose la partie serveur et l’intégralité de l’historique, page après page', async () => {
    const { service, calls } = setup({
      '/history/fights': 450, // 3 pages de 200 (200 + 200 + 50)
      '/history/purchases': 200, // exactement une page pleine : une seconde, vide, ferme
      '/history/trades': 0,
      '/history/pacts': 7,
    });
    const result = await service.build();

    expect(result.user.email).toBe('a@b.c');
    expect(result.identities[0].providerUid).toBe('42');
    expect(result.settings['profile'].value).toEqual({ name: 'A' });
    expect(result.history.fight).toHaveLength(450);
    expect(result.history.purchase).toHaveLength(200);
    expect(result.history.trade).toHaveLength(0);
    expect(result.history.pact).toHaveLength(7);
    // Aucun doublon ni trou : les curseurs se sont bien enchaînés.
    expect((result.history.fight as { n: number }[]).map((e) => e.n)).toEqual(
      Array.from({ length: 450 }, (_, i) => i),
    );
    expect(calls.filter((c) => c.startsWith('/history/fights'))).toHaveLength(3);
    expect(calls.every((c) => c === '/auth/export' || c.includes('limit=200'))).toBe(true);
  });

  it('échoue en bloc dès qu’une page manque : jamais de fichier partiel', async () => {
    const { service } = setup({ '/history/fights': 10, '/history/trades': 10 }, '/history/trades');
    await expect(service.build()).rejects.toThrow('account-export-failed');
  });

  it('échoue si la partie serveur est inaccessible', async () => {
    const { service } = setup({}, '/auth/export');
    await expect(service.build()).rejects.toThrow('account-export-failed');
  });
});
