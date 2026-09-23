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
import { SESSION_MAX_LIFETIME_MS, resolveSession } from './flow';
import {
  MAX_REQUESTER_USER_AGENT_LENGTH,
  NATIVE_SESSION_ROTATION_GRACE_MS,
  PAIRING_TTL_MS,
  claimPairing,
  findPendingPairingInfo,
  isNativeSession,
  isWellFormedPollToken,
  normalizeUserCode,
  pairingRequesterFromRequest,
  pollPairing,
  rotateNativeSession,
  startPairing,
} from './pairing';
import type { RotatedNativeSession } from './pairing';
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
/** Rotation censée réussir (le cas `null` — rattrapage refusé — a ses propres tests). */
async function rotate(
  store: AuthStore,
  params: { current: SessionRecord; now: Date },
): Promise<RotatedNativeSession> {
  const rotated = await rotateNativeSession(store, params);
  if (!rotated) throw new Error('rotation refusée');
  return rotated;
}

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

    const rotated = await rotate(store, { current: session, now: later });

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

    const rotated = await rotate(store, { current: session, now: NOW });
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

    const rotated = await rotate(store, { current: session, now: almostExpired });

    expect(rotated.previousTokenValidUntil).toEqual(session.expiresAt);
  });

  it('retire l’ancienne session de la liste des appareils, la nouvelle la représente', async () => {
    const store = createMemoryAuthStore();
    const { user, session } = await pairedSession(store);
    expect(await store.listSessions(user.id, NOW)).toHaveLength(1);

    const rotated = await rotate(store, { current: session, now: NOW });

    const listed = await store.listSessions(user.id, NOW);
    expect(listed).toHaveLength(1);
    expect(listed[0].idHash).toBe(await sha256Hex(rotated.token));
  });

  it('« déconnecter tous mes appareils » emporte aussi l’ancien jeton en grâce', async () => {
    const store = createMemoryAuthStore();
    const { user, token, session } = await pairedSession(store);
    const rotated = await rotate(store, { current: session, now: NOW });

    expect(await store.revokeAllSessions(user.id, NOW)).toBe(2);

    expect(await resolveSession(store, token, NOW)).toBeNull();
    expect(await resolveSession(store, rotated.token, NOW)).toBeNull();
  });

  it('admet une seconde rotation depuis l’ancien jeton encore en grâce (plantage avant écriture)', async () => {
    const store = createMemoryAuthStore();
    const { token, session } = await pairedSession(store);
    const first = await rotate(store, { current: session, now: NOW });

    // L'overlay a planté sans persister `first.token` : au redémarrage, il n'a que l'ancien.
    const restart = new Date(NOW.getTime() + 60 * 1000);
    const current = (await resolveSession(store, token, restart))?.session;
    if (!current) throw new Error('unreachable');
    const second = await rotate(store, { current, now: restart });

    expect(second.token).not.toBe(first.token);
    expect(await resolveSession(store, second.token, restart)).not.toBeNull();
    // La grâce d'origine n'est pas rallongée par cette seconde rotation.
    expect(second.previousTokenValidUntil).toEqual(first.previousTokenValidUntil);
    expect((await store.findSession(current.idHash))?.supersededAt).toEqual(NOW);
  });
});

/** Audit de sécurité du 2026-09-23 — appairage. */
describe('pairing — durcissement', () => {
  it('expire au bout de 5 minutes', async () => {
    expect(PAIRING_TTL_MS).toBe(5 * 60 * 1000);
    const store = createMemoryAuthStore();
    const { expiresAt } = await startPairing(store, NOW);
    expect(expiresAt).toEqual(new Date(NOW.getTime() + 5 * 60 * 1000));
  });

  it('efface la session créée quand la réclamation échoue (aucune session orpheline)', async () => {
    const store = createMemoryAuthStore();
    const { userCode } = await startPairing(store, NOW);
    expect(await claimPairing(store, { userCode, user: USER, now: NOW })).not.toBeNull();
    expect(store.sessions.size).toBe(1);

    // Code déjà réclamé, puis code inconnu : aucune session ne doit rester derrière.
    expect(await claimPairing(store, { userCode, user: USER, now: NOW })).toBeNull();
    expect(await claimPairing(store, { userCode: 'ZZZZZZZZ', user: USER, now: NOW })).toBeNull();
    expect(store.sessions.size).toBe(1);
  });

  it('efface la session créée quand la réclamation lève', async () => {
    const store = createMemoryAuthStore();
    const failing: AuthStore = {
      ...store,
      claimPairing: async () => {
        throw new Error('base indisponible');
      },
    };
    await expect(
      claimPairing(failing, { userCode: 'ABCDEFGH', user: USER, now: NOW }),
    ).rejects.toThrow('base indisponible');
    expect(store.sessions.size).toBe(0);
  });

  it('la session issue d’un appairage est native, ouvre une chaîne et porte une échéance absolue', async () => {
    const store = createMemoryAuthStore();
    const { deviceCode, userCode } = await startPairing(store, NOW);
    await claimPairing(store, { userCode, user: USER, now: NOW });
    const polled = await pollPairing(store, deviceCode, NOW);
    if (polled.status !== 'claimed') throw new Error('unreachable');
    const session = await store.findSession(await sha256Hex(polled.token));
    if (!session) throw new Error('unreachable');
    expect(isNativeSession(session)).toBe(true);
    expect(session.chainId).toBe(session.idHash);
    expect(session.absoluteExpiresAt).toEqual(new Date(NOW.getTime() + SESSION_MAX_LIFETIME_MS));
  });

  it('expose l’âge, le pays et le user-agent d’une demande en attente, jamais après confirmation', async () => {
    const store = createMemoryAuthStore();
    const request = new Request('https://wakfu.example/api/v1/auth/native/pair', {
      method: 'POST',
      headers: { 'cf-ipcountry': 'fr', 'user-agent': 'WakfuOverlay/1.2 (Windows)' },
    });
    const { userCode } = await startPairing(store, NOW, pairingRequesterFromRequest(request));

    const later = new Date(NOW.getTime() + 42 * 1000);
    const info = await findPendingPairingInfo(store, userCode, later);
    expect(info).toEqual({
      pairingCode: userCode,
      requestedAt: NOW,
      ageSeconds: 42,
      expiresAt: new Date(NOW.getTime() + PAIRING_TTL_MS),
      expiresInSeconds: PAIRING_TTL_MS / 1000 - 42,
      country: 'FR',
      userAgent: 'WakfuOverlay/1.2 (Windows)',
    });
    expect(JSON.stringify(info)).not.toMatch(/deviceCode|pollToken/);

    await claimPairing(store, { userCode, user: USER, now: later });
    expect(await findPendingPairingInfo(store, userCode, later)).toBeNull();
    expect(await findPendingPairingInfo(store, 'ZZZZZZZZ', later)).toBeNull();
  });

  it('ne garde du demandeur qu’un pays bien formé et un user-agent tronqué, sans contrôle', () => {
    const request = new Request('https://wakfu.example/', {
      headers: { 'cf-ipcountry': 'France', 'user-agent': `a\tb${'x'.repeat(500)}` },
    });
    const requester = pairingRequesterFromRequest(request);
    expect(requester.country).toBeNull();
    expect(requester.userAgent?.length).toBe(MAX_REQUESTER_USER_AGENT_LENGTH);
    expect(requester.userAgent?.startsWith('ab')).toBe(true);
    expect(pairingRequesterFromRequest(new Request('https://wakfu.example/'))).toEqual({
      country: null,
      userAgent: null,
    });
  });

  it('valide la forme du code d’appairage et du pollToken', () => {
    expect(normalizeUserCode(' abcd2345 ')).toBe('ABCD2345');
    expect(normalizeUserCode('ABCD0345')).toBeNull(); // 0 hors alphabet
    expect(normalizeUserCode('ABCD234')).toBeNull();
    expect(normalizeUserCode(12345678)).toBeNull();
    expect(isWellFormedPollToken('A'.repeat(43))).toBe(true);
    expect(isWellFormedPollToken('A'.repeat(42))).toBe(false);
    expect(isWellFormedPollToken(`${'A'.repeat(42)}=`)).toBe(false);
    expect(isWellFormedPollToken('auth:x')).toBe(false);
  });

  it('émet des codes et des pollTokens conformes à leur propre validation', async () => {
    const store = createMemoryAuthStore();
    for (let i = 0; i < 20; i++) {
      const { userCode, deviceCode } = await startPairing(store, NOW);
      expect(normalizeUserCode(userCode)).toBe(userCode);
      expect(isWellFormedPollToken(deviceCode)).toBe(true);
    }
  });
});

/** Audit de sécurité du 2026-09-23 — rotation native. */
describe('rotateNativeSession — plafond et rattrapage unique', () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function paired(store: AuthStore): Promise<{ token: string; session: SessionRecord }> {
    const user = await store.createUser({ email: USER.email, displayName: USER.displayName });
    const { deviceCode, userCode } = await startPairing(store, NOW);
    await claimPairing(store, { userCode, user, now: NOW });
    const polled = await pollPairing(store, deviceCode, NOW);
    if (polled.status !== 'claimed') throw new Error('unreachable');
    const session = await store.findSession(await sha256Hex(polled.token));
    if (!session) throw new Error('unreachable');
    return { token: polled.token, session };
  }

  it('propage la chaîne et l’échéance absolue d’une rotation à l’autre', async () => {
    const store = createMemoryAuthStore();
    const { session } = await paired(store);
    let current = session;
    let lastToken = '';
    let at = NOW;
    for (let i = 0; i < 7; i++) {
      at = new Date(at.getTime() + 25 * DAY);
      const rotated = await rotateNativeSession(store, { current, now: at });
      if (!rotated) throw new Error('rotation refusée');
      expect(rotated.expiresAt.getTime()).toBeLessThanOrEqual(
        NOW.getTime() + SESSION_MAX_LIFETIME_MS,
      );
      const next = await store.findSession(await sha256Hex(rotated.token));
      if (!next) throw new Error('unreachable');
      expect(next.chainId).toBe(session.idHash);
      expect(next.absoluteExpiresAt).toEqual(session.absoluteExpiresAt);
      current = next;
      lastToken = rotated.token;
    }
    // 175 jours de rotations : le dernier jeton meurt quand même au plafond des 180 jours.
    const cap = NOW.getTime() + SESSION_MAX_LIFETIME_MS;
    expect(current.expiresAt.getTime()).toBe(cap);
    expect(await resolveSession(store, lastToken, new Date(cap - 60 * 1000))).not.toBeNull();
    expect(await resolveSession(store, lastToken, new Date(cap))).toBeNull();
  });

  it('rattrapage depuis l’ancien jeton : admis une fois, révoque le jeton perdu', async () => {
    const store = createMemoryAuthStore();
    const { token, session } = await paired(store);
    const lost = await rotateNativeSession(store, { current: session, now: NOW });
    if (!lost) throw new Error('unreachable');

    const restart = new Date(NOW.getTime() + 60 * 1000);
    const old = (await resolveSession(store, token, restart))?.session;
    if (!old) throw new Error('unreachable');
    const recovered = await rotateNativeSession(store, { current: old, now: restart });
    expect(recovered).not.toBeNull();
    // Le jeton émis par la rotation « perdue » est révoqué : s'il avait été volé, il ne sert plus.
    expect(await resolveSession(store, lost.token, restart)).toBeNull();
    expect(await resolveSession(store, recovered?.token ?? '', restart)).not.toBeNull();
  });

  it('second rattrapage depuis le même ancien jeton : refusé, toute la chaîne révoquée', async () => {
    const store = createMemoryAuthStore();
    const { token, session } = await paired(store);
    await rotateNativeSession(store, { current: session, now: NOW });

    const t1 = new Date(NOW.getTime() + 60 * 1000);
    const old1 = (await resolveSession(store, token, t1))?.session;
    if (!old1) throw new Error('unreachable');
    const recovered = await rotateNativeSession(store, { current: old1, now: t1 });
    if (!recovered) throw new Error('unreachable');

    const t2 = new Date(NOW.getTime() + 120 * 1000);
    const old2 = (await resolveSession(store, token, t2))?.session;
    if (!old2) throw new Error('unreachable');
    expect(await rotateNativeSession(store, { current: old2, now: t2 })).toBeNull();

    expect(await resolveSession(store, token, t2)).toBeNull();
    expect(await resolveSession(store, recovered.token, t2)).toBeNull();
    const live = [...store.sessions.values()].filter((s) => s.revokedAt === null);
    expect(live).toHaveLength(0);
  });

  it('ne touche pas aux sessions d’une autre chaîne du même compte', async () => {
    const store = createMemoryAuthStore();
    const user = await store.createUser({ email: USER.email, displayName: USER.displayName });
    const pairOnce = async () => {
      const { deviceCode, userCode } = await startPairing(store, NOW);
      await claimPairing(store, { userCode, user, now: NOW });
      const polled = await pollPairing(store, deviceCode, NOW);
      if (polled.status !== 'claimed') throw new Error('unreachable');
      return polled.token;
    };
    const tokenA = await pairOnce();
    const tokenB = await pairOnce();
    const sessionA = await store.findSession(await sha256Hex(tokenA));
    if (!sessionA) throw new Error('unreachable');
    await rotateNativeSession(store, { current: sessionA, now: NOW });
    const t = new Date(NOW.getTime() + 1000);
    const a1 = (await resolveSession(store, tokenA, t))?.session;
    if (!a1) throw new Error('unreachable');
    await rotateNativeSession(store, { current: a1, now: t });
    const a2 = (await resolveSession(store, tokenA, t))?.session;
    if (!a2) throw new Error('unreachable');
    expect(await rotateNativeSession(store, { current: a2, now: t })).toBeNull();

    expect(await resolveSession(store, tokenB, t)).not.toBeNull();
  });
});
