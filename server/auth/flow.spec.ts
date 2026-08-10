/**
 * Tests du flux d'authentification (lot 5, prompt 5.1) : les quatre
 * exigences explicites du prompt — `state` invalide rejeté, code réutilisé
 * rejeté, session révoquée refusée, fusion sur e-mail identique — plus les
 * garanties voisines qu'il serait coûteux de découvrir en production
 * (redirection ouverte, CSRF, expiration glissante, limitation de débit).
 *
 * Aucune base ni réseau : `createMemoryAuthStore` implémente le même port que
 * l'implémentation Postgres, et le profil OAuth est injecté (voir
 * server/auth/flow.ts sur ce choix de conception).
 */

import { describe, expect, it } from 'vitest';
import { sha256Hex } from './crypto';
import {
  completeAuthorization,
  deriveCsrfToken,
  openSession,
  resolveSession,
  sanitizeRedirectTo,
  startAuthorization,
  verifyCsrf,
} from './flow';
import { createMemoryAuthStore } from './memory-store';
import type { OAuthProfile } from './providers';
import { CALLBACK_RULE, checkRateLimit } from './rate-limit';
import type { AuthStore, ProviderId } from './store';

const NOW = new Date('2026-08-10T12:00:00Z');

function profile(overrides: Partial<OAuthProfile> = {}): OAuthProfile {
  return {
    providerUid: 'uid-1',
    email: 'joueur@example.com',
    displayName: 'Joueur',
    ...overrides,
  };
}

/** Déroule un flux complet start → callback, comme le fait la route callback.ts. */
async function login(
  store: AuthStore,
  options: {
    provider?: ProviderId;
    oauthProfile?: OAuthProfile | null;
    now?: Date;
    redirectTo?: string | null;
    tamperState?: (state: string) => string;
  } = {},
) {
  const provider = options.provider ?? 'discord';
  const now = options.now ?? NOW;
  const { state } = await startAuthorization(store, {
    provider,
    redirectTo: options.redirectTo ?? null,
    now,
  });
  const presentedState = options.tamperState ? options.tamperState(state) : state;
  return completeAuthorization(store, {
    provider,
    state: presentedState,
    cookieState: presentedState,
    now,
    userAgent: 'test-agent',
    fetchProfile: async () =>
      options.oauthProfile === undefined ? profile() : options.oauthProfile,
  });
}

describe('completeAuthorization — validation du state', () => {
  it('rejette un state inconnu', async () => {
    const store = createMemoryAuthStore();
    const result = await completeAuthorization(store, {
      provider: 'discord',
      state: 'state-jamais-emis',
      cookieState: 'state-jamais-emis',
      now: NOW,
      userAgent: null,
      fetchProfile: async () => profile(),
    });
    expect(result).toEqual({ ok: false, error: 'invalid_state' });
  });

  it('rejette un state qui ne correspond pas au cookie du navigateur', async () => {
    const store = createMemoryAuthStore();
    const { state } = await startAuthorization(store, {
      provider: 'discord',
      redirectTo: null,
      now: NOW,
    });
    const result = await completeAuthorization(store, {
      provider: 'discord',
      state,
      cookieState: 'un-autre-state',
      now: NOW,
      userAgent: null,
      fetchProfile: async () => profile(),
    });
    expect(result).toEqual({ ok: false, error: 'invalid_state' });
  });

  it('rejette un state expiré (au-delà des 10 minutes)', async () => {
    const store = createMemoryAuthStore();
    const { state } = await startAuthorization(store, {
      provider: 'discord',
      redirectTo: null,
      now: NOW,
    });
    const result = await completeAuthorization(store, {
      provider: 'discord',
      state,
      cookieState: state,
      now: new Date(NOW.getTime() + 11 * 60 * 1000),
      userAgent: null,
      fetchProfile: async () => profile(),
    });
    expect(result).toEqual({ ok: false, error: 'invalid_state' });
  });

  it('rejette un state émis pour un autre fournisseur', async () => {
    const store = createMemoryAuthStore();
    const { state } = await startAuthorization(store, {
      provider: 'discord',
      redirectTo: null,
      now: NOW,
    });
    const result = await completeAuthorization(store, {
      provider: 'google',
      state,
      cookieState: state,
      now: NOW,
      userAgent: null,
      fetchProfile: async () => profile(),
    });
    expect(result).toEqual({ ok: false, error: 'provider_mismatch' });
  });
});

describe('completeAuthorization — usage unique du code', () => {
  it('rejette le rejeu du même state/code', async () => {
    const store = createMemoryAuthStore();
    const { state } = await startAuthorization(store, {
      provider: 'discord',
      redirectTo: null,
      now: NOW,
    });

    const first = await completeAuthorization(store, {
      provider: 'discord',
      state,
      cookieState: state,
      now: NOW,
      userAgent: null,
      fetchProfile: async () => profile(),
    });
    expect(first.ok).toBe(true);

    const replay = await completeAuthorization(store, {
      provider: 'discord',
      state,
      cookieState: state,
      now: NOW,
      userAgent: null,
      fetchProfile: async () => profile(),
    });
    expect(replay).toEqual({ ok: false, error: 'invalid_state' });
    expect(store.sessions.size).toBe(1); // aucune seconde session ouverte
  });

  it("ne permet pas de rejouer un code après un échec d'échange", async () => {
    const store = createMemoryAuthStore();
    const { state } = await startAuthorization(store, {
      provider: 'discord',
      redirectTo: null,
      now: NOW,
    });

    const failed = await completeAuthorization(store, {
      provider: 'discord',
      state,
      cookieState: state,
      now: NOW,
      userAgent: null,
      fetchProfile: async () => null,
    });
    expect(failed).toEqual({ ok: false, error: 'exchange_failed' });

    const retry = await completeAuthorization(store, {
      provider: 'discord',
      state,
      cookieState: state,
      now: NOW,
      userAgent: null,
      fetchProfile: async () => profile(),
    });
    expect(retry).toEqual({ ok: false, error: 'invalid_state' });
  });
});

describe('resolveSession', () => {
  it('accepte une session valide et applique l’expiration glissante', async () => {
    const store = createMemoryAuthStore();
    const user = await store.createUser({ email: null, displayName: null });
    const session = await openSession(store, user.id, { now: NOW, userAgent: null });

    const sameDay = await resolveSession(store, session.token, NOW);
    expect(sameDay?.user.id).toBe(user.id);
    expect(sameDay?.session.expiresAt).toEqual(session.expiresAt);

    // 2 jours plus tard : il reste moins de 29 jours, la session est prolongée.
    const later = new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000);
    const refreshed = await resolveSession(store, session.token, later);
    expect(refreshed?.session.expiresAt.getTime()).toBeGreaterThan(session.expiresAt.getTime());
  });

  it('refuse une session révoquée', async () => {
    const store = createMemoryAuthStore();
    const user = await store.createUser({ email: null, displayName: null });
    const session = await openSession(store, user.id, { now: NOW, userAgent: null });

    expect(await resolveSession(store, session.token, NOW)).not.toBeNull();

    await store.revokeSession(session.idHash, NOW);

    expect(await resolveSession(store, session.token, NOW)).toBeNull();
  });

  it('refuse une session expirée et un jeton inconnu', async () => {
    const store = createMemoryAuthStore();
    const user = await store.createUser({ email: null, displayName: null });
    const session = await openSession(store, user.id, { now: NOW, userAgent: null });

    const after = new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(await resolveSession(store, session.token, after)).toBeNull();
    expect(await resolveSession(store, 'jeton-inconnu', NOW)).toBeNull();
    expect(await resolveSession(store, null, NOW)).toBeNull();
  });

  it('ne stocke jamais le jeton en clair, seulement son empreinte', async () => {
    const store = createMemoryAuthStore();
    const user = await store.createUser({ email: null, displayName: null });
    const session = await openSession(store, user.id, { now: NOW, userAgent: null });

    expect(store.sessions.has(session.token)).toBe(false);
    expect(store.sessions.has(await sha256Hex(session.token))).toBe(true);
  });

  it('révoque la session courante à la reconnexion (rotation)', async () => {
    const store = createMemoryAuthStore();
    const first = await login(store);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const firstIdHash = await sha256Hex(first.result.token);
    const { state } = await startAuthorization(store, {
      provider: 'discord',
      redirectTo: null,
      now: NOW,
    });
    const second = await completeAuthorization(store, {
      provider: 'discord',
      state,
      cookieState: state,
      now: NOW,
      userAgent: null,
      currentSessionIdHash: firstIdHash,
      fetchProfile: async () => profile(),
    });

    expect(second.ok).toBe(true);
    expect(await resolveSession(store, first.result.token, NOW)).toBeNull();
  });
});

describe('fusion de comptes', () => {
  it('rattache Google à un compte Discord existant sur e-mail vérifié identique', async () => {
    const store = createMemoryAuthStore();

    const viaDiscord = await login(store, {
      provider: 'discord',
      oauthProfile: profile({ providerUid: 'discord-1' }),
    });
    expect(viaDiscord.ok).toBe(true);
    if (!viaDiscord.ok) return;
    expect(viaDiscord.result.isNewUser).toBe(true);

    const viaGoogle = await login(store, {
      provider: 'google',
      oauthProfile: profile({ providerUid: 'google-1', displayName: 'Joueur (Google)' }),
    });
    expect(viaGoogle.ok).toBe(true);
    if (!viaGoogle.ok) return;

    expect(viaGoogle.result.user.id).toBe(viaDiscord.result.user.id);
    expect(viaGoogle.result.isNewUser).toBe(false);
    expect(store.users.size).toBe(1);
    expect(
      (await store.listIdentities(viaGoogle.result.user.id)).map((i) => i.provider).sort(),
    ).toEqual(['discord', 'google']);
  });

  it('normalise la casse de l’e-mail avant de fusionner', async () => {
    const store = createMemoryAuthStore();
    const first = await login(store, {
      provider: 'discord',
      oauthProfile: profile({ providerUid: 'discord-1', email: 'Joueur@Example.COM' }),
    });
    const second = await login(store, {
      provider: 'google',
      oauthProfile: profile({ providerUid: 'google-1', email: 'joueur@example.com' }),
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.result.user.id).toBe(first.result.user.id);
    expect(store.users.size).toBe(1);
  });

  it('ne fusionne PAS quand le fournisseur ne donne pas d’e-mail vérifié', async () => {
    const store = createMemoryAuthStore();
    const first = await login(store, {
      provider: 'discord',
      oauthProfile: profile({ providerUid: 'discord-1' }),
    });
    // e-mail non vérifié côté fournisseur → normalisé en `null` (voir providers.ts)
    const second = await login(store, {
      provider: 'google',
      oauthProfile: profile({ providerUid: 'google-1', email: null }),
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.result.user.id).not.toBe(first.result.user.id);
    expect(store.users.size).toBe(2);
  });

  it('retrouve le même compte à la reconnexion avec la même identité', async () => {
    const store = createMemoryAuthStore();
    const first = await login(store, { oauthProfile: profile({ providerUid: 'discord-1' }) });
    const second = await login(store, { oauthProfile: profile({ providerUid: 'discord-1' }) });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.result.user.id).toBe(first.result.user.id);
    expect(second.result.isNewUser).toBe(false);
    expect(store.users.size).toBe(1);
  });
});

describe('suppression de compte', () => {
  it('supprime le compte, ses identités et ses sessions', async () => {
    const store = createMemoryAuthStore();
    const logged = await login(store);
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;

    await store.deleteUser(logged.result.user.id);

    expect(store.users.size).toBe(0);
    expect(store.identities.size).toBe(0);
    expect(await resolveSession(store, logged.result.token, NOW)).toBeNull();
  });
});

describe('jeton CSRF double-submit', () => {
  it('accepte le jeton dérivé de la session et refuse tout autre', async () => {
    const store = createMemoryAuthStore();
    const user = await store.createUser({ email: null, displayName: null });
    const session = await openSession(store, user.id, { now: NOW, userAgent: null });

    expect(await verifyCsrf(session.token, await deriveCsrfToken(session.token))).toBe(true);
    expect(await verifyCsrf(session.token, 'jeton-bidon')).toBe(false);
    expect(await verifyCsrf(session.token, null)).toBe(false);
    // Le jeton CSRF ne doit pas être le jeton de session lui-même.
    expect(session.csrfToken).not.toBe(session.token);
  });
});

describe('sanitizeRedirectTo', () => {
  it('accepte un chemin interne et rejette toute URL externe', () => {
    expect(sanitizeRedirectTo('/profil')).toBe('/profil');
    expect(sanitizeRedirectTo('//evil.example')).toBeNull();
    expect(sanitizeRedirectTo('https://evil.example')).toBeNull();
    expect(sanitizeRedirectTo('profil')).toBeNull();
    expect(sanitizeRedirectTo(null)).toBeNull();
  });

  it('conserve la cible de retour à travers le flux', async () => {
    const store = createMemoryAuthStore();
    const result = await login(store, { redirectTo: '/profil' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.redirectTo).toBe('/profil');
  });
});

describe('limitation de débit', () => {
  it('bloque au-delà de la limite puis repart à la fenêtre suivante', async () => {
    const store = createMemoryAuthStore();
    const bucket = 'auth:callback:ip:1.2.3.4';

    for (let i = 0; i < CALLBACK_RULE.limit; i++) {
      expect((await checkRateLimit(store, bucket, CALLBACK_RULE, NOW)).allowed).toBe(true);
    }
    const blocked = await checkRateLimit(store, bucket, CALLBACK_RULE, NOW);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    const nextWindow = new Date(NOW.getTime() + CALLBACK_RULE.windowMs);
    expect((await checkRateLimit(store, bucket, CALLBACK_RULE, nextWindow)).allowed).toBe(true);
  });
});
