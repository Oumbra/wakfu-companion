/**
 * Tests de l'appairage de client natif (overlay, lot L4 —
 * `docs/plan-architecture.md` §7.2 de `wakfu-companion-overlay`) : code
 * inconnu rejeté, code expiré rejeté, un code ne peut être réclamé qu'une
 * fois, le jeton n'est renvoyé qu'une seule fois par `poll`.
 *
 * Aucune base ni réseau : `createMemoryAuthStore` implémente le même port
 * que l'implémentation Postgres (voir server/auth/flow.spec.ts pour le même
 * principe côté OAuth).
 */

import { describe, expect, it } from 'vitest';
import { PAIRING_TTL_MS, claimPairing, pollPairing, startPairing } from './pairing';
import { createMemoryAuthStore } from './memory-store';
import type { UserRecord } from './store';

const NOW = new Date('2026-08-10T12:00:00Z');

const USER: UserRecord = { id: 'user-1', email: 'joueur@example.com', displayName: 'Joueur' };

describe('pairing', () => {
  it('rejette un userCode inconnu à la confirmation', async () => {
    const store = createMemoryAuthStore();
    await startPairing(store, NOW);

    const claimed = await claimPairing(store, { userCode: 'NOPENOPE', user: USER, now: NOW });
    expect(claimed).toBeNull();
  });

  it('rejette un poll pour un deviceCode inconnu', async () => {
    const store = createMemoryAuthStore();
    const result = await pollPairing(store, 'unknown-device-code', NOW);
    expect(result).toEqual({ status: 'expired' });
  });

  it("reste pending tant que le code n'a pas été confirmé", async () => {
    const store = createMemoryAuthStore();
    const { deviceCode } = await startPairing(store, NOW);

    const result = await pollPairing(store, deviceCode, NOW);
    expect(result).toEqual({ status: 'pending' });
  });

  it('confirme puis renvoie le jeton une seule fois', async () => {
    const store = createMemoryAuthStore();
    const { deviceCode, userCode } = await startPairing(store, NOW);

    const claimed = await claimPairing(store, { userCode, user: USER, now: NOW });
    expect(claimed).not.toBeNull();

    const first = await pollPairing(store, deviceCode, NOW);
    expect(first.status).toBe('claimed');
    if (first.status !== 'claimed') throw new Error('unreachable');
    expect(first.token).toBe(claimed?.token);

    // Rejeu du même poll : le jeton n'est plus là (déjà consommé).
    const second = await pollPairing(store, deviceCode, NOW);
    expect(second).toEqual({ status: 'expired' });
  });

  it('refuse un 2ᵉ claim sur un code déjà réclamé', async () => {
    const store = createMemoryAuthStore();
    const { userCode } = await startPairing(store, NOW);

    const first = await claimPairing(store, { userCode, user: USER, now: NOW });
    expect(first).not.toBeNull();

    const second = await claimPairing(store, { userCode, user: USER, now: NOW });
    expect(second).toBeNull();
  });

  it('rejette un claim après expiration', async () => {
    const store = createMemoryAuthStore();
    const { userCode } = await startPairing(store, NOW);

    const afterExpiry = new Date(NOW.getTime() + PAIRING_TTL_MS + 1000);
    const claimed = await claimPairing(store, { userCode, user: USER, now: afterExpiry });
    expect(claimed).toBeNull();
  });

  it('rejette un poll après expiration, même sans avoir été réclamé', async () => {
    const store = createMemoryAuthStore();
    const { deviceCode } = await startPairing(store, NOW);

    const afterExpiry = new Date(NOW.getTime() + PAIRING_TTL_MS + 1000);
    const result = await pollPairing(store, deviceCode, afterExpiry);
    expect(result).toEqual({ status: 'expired' });
  });

  it('crée une session réelle utilisable une fois le jeton récupéré', async () => {
    const store = createMemoryAuthStore();
    const { deviceCode, userCode } = await startPairing(store, NOW);
    await claimPairing(store, { userCode, user: USER, now: NOW });
    const polled = await pollPairing(store, deviceCode, NOW);
    if (polled.status !== 'claimed') throw new Error('unreachable');

    const { sha256Hex } = await import('./crypto');
    const session = await store.findSession(await sha256Hex(polled.token));
    expect(session?.userId).toBe(USER.id);
    expect(session?.userAgent).toBe('native-overlay');
  });
});
