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
import { sha256Hex } from './crypto';
import { SESSION_TTL_MS } from './cookies';
import { resolveSession } from './flow';
import {
  NATIVE_SESSION_ROTATION_GRACE_MS,
  PAIRING_TTL_MS,
  claimPairing,
  pollPairing,
  rotateNativeSession,
  startPairing,
} from './pairing';
import { createMemoryAuthStore } from './memory-store';
import type { AuthStore, SessionRecord, UserRecord } from './store';

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

    const session = await store.findSession(await sha256Hex(polled.token));
    expect(session?.userId).toBe(USER.id);
    expect(session?.userAgent).toBe('native-overlay');
  });
});

/**
 * Rotation du jeton natif (`POST /api/v1/auth/native/session`, constat C5 de
 * l'analyse RGPD de l'overlay) : jeton neuf de 30 jours, ancien jeton toléré
 * pendant une courte grâce non prolongeable, puis mort.
 */
describe('rotateNativeSession', () => {
  /** Compte réel + appairage complet, comme l'overlay le vit : rend le jeton et sa ligne de session. */
  async function pairedSession(
    store: AuthStore,
  ): Promise<{ user: UserRecord; token: string; session: SessionRecord }> {
    const user = await store.createUser({ email: USER.email, displayName: USER.displayName });
    const { deviceCode, userCode } = await startPairing(store, NOW);
    await claimPairing(store, { userCode, user, now: NOW });
    const polled = await pollPairing(store, deviceCode, NOW);
    if (polled.status !== 'claimed') throw new Error('unreachable');
    const session = await store.findSession(await sha256Hex(polled.token));
    if (!session) throw new Error('unreachable');
    return { user, token: polled.token, session };
  }

  it('émet un jeton neuf de 30 jours, sur le même compte et le même appareil', async () => {
    const store = createMemoryAuthStore();
    const { user, token, session } = await pairedSession(store);
    const later = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);

    const rotated = await rotateNativeSession(store, { current: session, now: later });

    expect(rotated.token).not.toBe(token);
    expect(rotated.issuedAt).toEqual(later);
    expect(rotated.expiresAt).toEqual(new Date(later.getTime() + SESSION_TTL_MS));
    const resolved = await resolveSession(store, rotated.token, later);
    expect(resolved?.user.id).toBe(user.id);
    expect(resolved?.session.userAgent).toBe('native-overlay');
    expect(resolved?.session.supersededAt).toBeNull();
  });

  it('tolère l’ancien jeton pendant la grâce, sans jamais le prolonger, puis le refuse', async () => {
    const store = createMemoryAuthStore();
    const { user, token, session } = await pairedSession(store);

    const rotated = await rotateNativeSession(store, { current: session, now: NOW });
    expect(rotated.previousTokenValidUntil).toEqual(
      new Date(NOW.getTime() + NATIVE_SESSION_ROTATION_GRACE_MS),
    );

    // Une requête déjà partie avec l'ancien jeton aboutit encore...
    const duringGrace = new Date(NOW.getTime() + NATIVE_SESSION_ROTATION_GRACE_MS - 1000);
    const old = await resolveSession(store, token, duringGrace);
    expect(old?.user.id).toBe(user.id);
    // ...mais l'expiration glissante ne s'applique plus : la grâce reste la grâce.
    expect(old?.session.expiresAt).toEqual(rotated.previousTokenValidUntil);
    expect(old?.session.supersededAt).toEqual(NOW);

    const afterGrace = new Date(NOW.getTime() + NATIVE_SESSION_ROTATION_GRACE_MS);
    expect(await resolveSession(store, token, afterGrace)).toBeNull();
    expect(await resolveSession(store, rotated.token, afterGrace)).not.toBeNull();
  });

  it('ne raccourcit pas une session qui expirait déjà avant la fin de grâce', async () => {
    const store = createMemoryAuthStore();
    const { session } = await pairedSession(store);
    const almostExpired = new Date(session.expiresAt.getTime() - 60 * 1000);

    const rotated = await rotateNativeSession(store, { current: session, now: almostExpired });

    expect(rotated.previousTokenValidUntil).toEqual(session.expiresAt);
  });

  it('retire l’ancienne session de la liste des appareils, la nouvelle la représente', async () => {
    const store = createMemoryAuthStore();
    const { user, session } = await pairedSession(store);
    expect(await store.listSessions(user.id, NOW)).toHaveLength(1);

    const rotated = await rotateNativeSession(store, { current: session, now: NOW });

    const listed = await store.listSessions(user.id, NOW);
    expect(listed).toHaveLength(1);
    expect(listed[0].idHash).toBe(await sha256Hex(rotated.token));
  });

  it('« déconnecter tous mes appareils » emporte aussi l’ancien jeton en grâce', async () => {
    const store = createMemoryAuthStore();
    const { user, token, session } = await pairedSession(store);
    const rotated = await rotateNativeSession(store, { current: session, now: NOW });

    expect(await store.revokeAllSessions(user.id, NOW)).toBe(2);

    expect(await resolveSession(store, token, NOW)).toBeNull();
    expect(await resolveSession(store, rotated.token, NOW)).toBeNull();
  });

  it('admet une seconde rotation depuis l’ancien jeton encore en grâce (plantage avant écriture)', async () => {
    const store = createMemoryAuthStore();
    const { token, session } = await pairedSession(store);
    const first = await rotateNativeSession(store, { current: session, now: NOW });

    // L'overlay a planté sans persister `first.token` : au redémarrage, il n'a que l'ancien.
    const restart = new Date(NOW.getTime() + 60 * 1000);
    const current = (await resolveSession(store, token, restart))?.session;
    if (!current) throw new Error('unreachable');
    const second = await rotateNativeSession(store, { current, now: restart });

    expect(second.token).not.toBe(first.token);
    expect(await resolveSession(store, second.token, restart)).not.toBeNull();
    // La grâce d'origine n'est pas rallongée par cette seconde rotation.
    expect(second.previousTokenValidUntil).toEqual(first.previousTokenValidUntil);
    expect((await store.findSession(current.idHash))?.supersededAt).toEqual(NOW);
  });
});
