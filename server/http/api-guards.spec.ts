import { describe, expect, it, vi } from 'vitest';
import { createMemoryAuthStore } from '../auth/memory-store';
import { MAX_RATE_LIMIT_WINDOW_MS } from '../auth/rate-limit';
import type { AuthStore } from '../auth/store';
import {
  HISTORY_STATS_RULE,
  HISTORY_WRITE_RULE,
  SETTINGS_WRITE_RULE,
  enforceUserRateLimit,
  internalErrorResponse,
  userRateLimitBucket,
} from './api-guards';

const USER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const NOW = new Date('2026-09-23T12:03:00.000Z');

describe('limitation de débit par compte', () => {
  it('toutes les règles utilisent la fenêtre commune de 10 min (purge partagée)', () => {
    for (const rule of [HISTORY_WRITE_RULE, HISTORY_STATS_RULE, SETTINGS_WRITE_RULE]) {
      expect(rule.windowMs).toBe(MAX_RATE_LIMIT_WINDOW_MS);
    }
  });

  it('les seuils couvrent la cadence réelle des clients', () => {
    // File d'historique : un flush toutes les 2 s au plus pendant 10 min = 300 requêtes.
    expect(HISTORY_WRITE_RULE.limit).toBeGreaterThanOrEqual(300);
    // Configuration : debounce 1,5 s ⇒ 400 requêtes par 10 min en continu.
    expect(SETTINGS_WRITE_RULE.limit).toBeGreaterThanOrEqual(400);
  });

  it('compartimente par action et par compte', () => {
    expect(userRateLimitBucket('history:write', USER)).toBe(`history:write:user:${USER}`);
    expect(userRateLimitBucket('settings:write', USER)).not.toBe(
      userRateLimitBucket('history:write', USER),
    );
  });

  it('laisse passer jusqu’au seuil, puis répond 429 avec Retry-After', async () => {
    const store = createMemoryAuthStore();
    for (let i = 0; i < HISTORY_STATS_RULE.limit; i++) {
      expect(await enforceUserRateLimit(store, 'history:stats', USER, NOW)).toBeNull();
    }
    const blocked = await enforceUserRateLimit(store, 'history:stats', USER, NOW);
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get('retry-after')).toBe('420');
    expect(blocked?.headers.get('cache-control')).toBe('no-store');
    expect(await blocked?.json()).toEqual({ error: 'trop de requêtes', code: 'rate_limited' });

    // Un autre compte et une autre action ne sont pas affectés.
    expect(await enforceUserRateLimit(store, 'history:stats', OTHER, NOW)).toBeNull();
    expect(await enforceUserRateLimit(store, 'history:write', USER, NOW)).toBeNull();
    // Fenêtre suivante : de nouveau autorisé.
    const later = new Date(NOW.getTime() + MAX_RATE_LIMIT_WINDOW_MS);
    expect(await enforceUserRateLimit(store, 'history:stats', USER, later)).toBeNull();
  });

  it('laisse passer (en journalisant) si le comptage est indisponible', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = {
      bumpRateLimit: () => Promise.reject(new Error('base injoignable')),
      purgeRateLimits: () => Promise.resolve(),
    } as unknown as AuthStore;
    expect(await enforceUserRateLimit(broken, 'history:write', USER, NOW)).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('internalErrorResponse', () => {
  it('ne renvoie jamais le détail de l’erreur au client', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = internalErrorResponse(
      'test',
      new Error('duplicate key value violates unique constraint "fights_pkey" host=ep-secret'),
    );
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toBe('{"error":"erreur interne"}');
    expect(error).toHaveBeenCalledWith('[test]', expect.any(Error));
    error.mockRestore();
  });
});
