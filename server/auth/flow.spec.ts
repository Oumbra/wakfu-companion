/**
 * Tests du flux d'authentification (lot 5, prompt 5.1) : les quatre
 * exigences explicites du prompt — `state` invalide rejeté, code réutilisé
 * rejeté, session révoquée refusée, un seul fournisseur par compte — plus les
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
  MAX_USER_AGENT_LENGTH,
  openSession,
  purgeDeadSessions,
  purgeInactiveAccounts,
  SESSION_MAX_LIFETIME_MS,
  resolveSession,
  runFullPurge,
  sanitizeRedirectTo,
  startAuthorization,
  verifyCsrf,
} from './flow';
import { createMemoryAuthStore } from './memory-store';
import type { OAuthProfile } from './providers';
import { CALLBACK_RULE, checkRateLimit, clientIpKey } from './rate-limit';
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

  /**
   * Effacement demandé par un client natif — `DELETE /api/v1/auth/native/session`, constat C5 de
   * l'analyse RGPD de l'overlay. La ligne disparaît (contrairement à la révocation, qui la garde
   * avec son `revoked_at`), et le jeton est aussi inutilisable qu'un jeton inconnu.
   */
  it('refuse une session effacée, et l’effacement ne laisse pas de ligne', async () => {
    const store = createMemoryAuthStore();
    const user = await store.createUser({ email: null, displayName: null });
    const session = await openSession(store, user.id, { now: NOW, userAgent: 'overlay' });

    expect(await resolveSession(store, session.token, NOW)).not.toBeNull();

    expect(await store.deleteSession(session.idHash)).toBe(true);

    expect(await resolveSession(store, session.token, NOW)).toBeNull();
    expect(await store.findSession(session.idHash)).toBeNull();
    // Rejouer l'appel ne fabrique pas d'erreur : la route rend `deleted: false`.
    expect(await store.deleteSession(session.idHash)).toBe(false);
    // Les autres sessions du compte ne sont pas touchées.
    const autre = await openSession(store, user.id, { now: NOW, userAgent: null });
    expect(await store.deleteSession(session.idHash)).toBe(false);
    expect(await resolveSession(store, autre.token, NOW)).not.toBeNull();
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

/**
 * Limitation de la conservation (RGPD art. 5.1.e) : une session expirée ou
 * révoquée n'a plus d'usage passé un délai — sa ligne (`user_id`, `user_agent`,
 * horodatages) doit partir, sans cron, à l'occasion des appels existants.
 */
describe('purgeDeadSessions', () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function seed() {
    const store = createMemoryAuthStore();
    const user = await store.createUser({ email: null, displayName: null });
    const live = await openSession(store, user.id, { now: NOW, userAgent: 'vivante' });
    // Expirée il y a 31 jours (ouverte il y a 61 jours, jamais prolongée).
    const longExpired = await openSession(store, user.id, {
      now: new Date(NOW.getTime() - 61 * DAY),
      userAgent: 'expirée depuis longtemps',
    });
    // Expirée hier seulement.
    const freshlyExpired = await openSession(store, user.id, {
      now: new Date(NOW.getTime() - 31 * DAY),
      userAgent: 'expirée hier',
    });
    // Révoquée il y a 31 jours, mais pas encore expirée (elle courait jusqu'à J+29).
    const longRevoked = await openSession(store, user.id, {
      now: new Date(NOW.getTime() - 1 * DAY),
      userAgent: 'révoquée depuis longtemps',
    });
    await store.revokeSession(longRevoked.idHash, new Date(NOW.getTime() - 31 * DAY));
    // Révoquée hier.
    const freshlyRevoked = await openSession(store, user.id, {
      now: NOW,
      userAgent: 'révoquée hier',
    });
    await store.revokeSession(freshlyRevoked.idHash, new Date(NOW.getTime() - 1 * DAY));
    return { store, live, longExpired, freshlyExpired, longRevoked, freshlyRevoked };
  }

  it('efface ce qui est mort depuis plus de 30 jours, et rien d’autre', async () => {
    const { store, live, longExpired, freshlyExpired, longRevoked, freshlyRevoked } = await seed();

    expect(await purgeDeadSessions(store, NOW)).toBe(2);

    expect(await store.findSession(longExpired.idHash)).toBeNull();
    expect(await store.findSession(longRevoked.idHash)).toBeNull();
    expect(await store.findSession(live.idHash)).not.toBeNull();
    expect(await store.findSession(freshlyExpired.idHash)).not.toBeNull();
    expect(await store.findSession(freshlyRevoked.idHash)).not.toBeNull();
    expect(await resolveSession(store, live.token, NOW)).not.toBeNull();
  });

  it('rattrape le reste 30 jours plus tard, et ne touche jamais une session vivante', async () => {
    const { store, live } = await seed();
    await purgeDeadSessions(store, NOW);

    const later = new Date(NOW.getTime() + 31 * DAY);
    // La session vivante a expiré entre-temps (jamais prolongée), mais depuis un jour seulement.
    expect(await purgeDeadSessions(store, later)).toBe(2);
    expect(await store.findSession(live.idHash)).not.toBeNull();
    expect(store.sessions.size).toBe(1);
  });

  it('est déclenchée par la connexion et par le rafraîchissement glissant', async () => {
    const { store, longExpired } = await seed();
    expect(await store.findSession(longExpired.idHash)).not.toBeNull();

    const logged = await login(store);
    expect(logged.ok).toBe(true);
    expect(await store.findSession(longExpired.idHash)).toBeNull();

    // Une seconde ligne morte, puis un simple usage de session deux jours plus
    // tard : c'est le rafraîchissement quotidien qui fait le ménage.
    const dead = await openSession(store, 'user-x', {
      now: new Date(NOW.getTime() - 61 * DAY),
      userAgent: null,
    });
    if (!logged.ok) return;
    const later = new Date(NOW.getTime() + 2 * DAY);
    expect(await resolveSession(store, logged.result.token, later)).not.toBeNull();
    expect(await store.findSession(dead.idHash)).toBeNull();
  });
});

/**
 * Limitation de la conservation, volet compte (RGPD art. 5.1.e, décision du
 * 2026-09-20) : un compte sans activité authentifiée depuis 12 mois est effacé
 * avec tout ce qui lui est rattaché — sans cron, à l'occasion des appels
 * existants, et jamais par sa propre requête de retour.
 */
describe('purgeInactiveAccounts', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('efface un compte inactif depuis plus de 12 mois, avec identités et sessions', async () => {
    const store = createMemoryAuthStore();
    const logged = await login(store, { now: new Date(NOW.getTime() - 370 * DAY) });
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;
    const dormant = logged.result.user.id;
    const recent = await login(store, {
      oauthProfile: profile({ providerUid: 'uid-2', email: 'actif@example.com' }),
      now: new Date(NOW.getTime() - 360 * DAY),
    });
    expect(recent.ok).toBe(true);

    expect(await purgeInactiveAccounts(store, NOW)).toBe(1);
    expect(await store.findUserById(dormant)).toBeNull();
    expect(await store.findIdentity('discord', 'uid-1')).toBeNull();
    expect([...store.sessions.values()].some((s) => s.userId === dormant)).toBe(false);
    expect(await store.findIdentity('discord', 'uid-2')).not.toBeNull();
  });

  it("l'usage quotidien d'une session (web ou overlay) tient le compte vivant sans reconnexion", async () => {
    const store = createMemoryAuthStore();
    // Depuis l'audit du 2026-09-23, une session vit au plus SESSION_MAX_LIFETIME_MS (180 j) : le
    // scénario tient dans cette durée (voir « durée de vie absolue » pour ce qui se passe au-delà).
    const logged = await login(store, { now: new Date(NOW.getTime() - 170 * DAY) });
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;
    // L'overlay sert tous les jours : le rafraîchissement glissant marque l'activité.
    for (let d = 169; d >= 0; d -= 10) {
      const at = new Date(NOW.getTime() - d * DAY);
      expect(await resolveSession(store, logged.result.token, at)).not.toBeNull();
    }
    expect(store.lastSeenAt.get(logged.result.user.id)?.getTime()).toBeGreaterThan(
      NOW.getTime() - 10 * DAY,
    );
    expect(await purgeInactiveAccounts(store, NOW)).toBe(0);
    expect(await store.findUserById(logged.result.user.id)).not.toBeNull();
  });

  it('est déclenchée par la connexion, qui ne purge jamais le compte qui revient', async () => {
    const store = createMemoryAuthStore();
    const dormant = await login(store, {
      oauthProfile: profile({ providerUid: 'uid-dormant', email: 'dormant@example.com' }),
      now: new Date(NOW.getTime() - 370 * DAY),
    });
    const returning = await login(store, { now: new Date(NOW.getTime() - 370 * DAY) });
    expect(dormant.ok && returning.ok).toBe(true);
    if (!dormant.ok || !returning.ok) return;

    // Le compte `returning` revient après 370 jours : il est marqué actif AVANT
    // la purge, qui n'emporte que l'autre.
    const back = await login(store);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.result.user.id).toBe(returning.result.user.id);
    expect(back.result.isNewUser).toBe(false);
    expect(await store.findUserById(dormant.result.user.id)).toBeNull();
  });
});

describe('un compte = un seul fournisseur', () => {
  it('refuse Google quand l’e-mail vérifié appartient déjà à un compte Discord', async () => {
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
    expect(viaGoogle).toEqual({ ok: false, error: 'email_taken', existingProvider: 'discord' });

    // Rien n'a été rattaché ni créé.
    expect(store.users.size).toBe(1);
    expect((await store.listIdentities(viaDiscord.result.user.id)).map((i) => i.provider)).toEqual([
      'discord',
    ]);
    expect(await store.findIdentity('google', 'google-1')).toBeNull();
  });

  it('normalise la casse de l’e-mail avant de comparer', async () => {
    const store = createMemoryAuthStore();
    const first = await login(store, {
      provider: 'google',
      oauthProfile: profile({ providerUid: 'google-1', email: 'Joueur@Example.COM' }),
    });
    const second = await login(store, {
      provider: 'discord',
      oauthProfile: profile({ providerUid: 'discord-1', email: 'joueur@example.com' }),
    });
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: 'email_taken', existingProvider: 'google' });
    expect(store.users.size).toBe(1);
  });

  it('ne révoque pas la session déjà ouverte quand la connexion est refusée', async () => {
    const store = createMemoryAuthStore();
    const first = await login(store, {
      provider: 'discord',
      oauthProfile: profile({ providerUid: 'discord-1' }),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const { state } = await startAuthorization(store, {
      provider: 'google',
      redirectTo: null,
      now: NOW,
    });
    const refused = await completeAuthorization(store, {
      provider: 'google',
      state,
      cookieState: state,
      now: NOW,
      userAgent: 'test-agent',
      currentSessionIdHash: await sha256Hex(first.result.token),
      fetchProfile: async () => profile({ providerUid: 'google-1' }),
    });
    expect(refused.ok).toBe(false);
    expect(await resolveSession(store, first.result.token, NOW)).not.toBeNull();
  });

  it('garde les comptes déjà liés aux deux fournisseurs avant la règle', async () => {
    const store = createMemoryAuthStore();
    const viaDiscord = await login(store, {
      provider: 'discord',
      oauthProfile: profile({ providerUid: 'discord-1' }),
    });
    expect(viaDiscord.ok).toBe(true);
    if (!viaDiscord.ok) return;
    // Identité Google rattachée du temps de la fusion automatique.
    await store.linkIdentity({
      userId: viaDiscord.result.user.id,
      provider: 'google',
      providerUid: 'google-1',
      email: 'joueur@example.com',
      now: NOW,
    });

    const viaGoogle = await login(store, {
      provider: 'google',
      oauthProfile: profile({ providerUid: 'google-1' }),
    });
    expect(viaGoogle.ok).toBe(true);
    if (!viaGoogle.ok) return;
    expect(viaGoogle.result.user.id).toBe(viaDiscord.result.user.id);
  });

  it('ouvre un compte distinct quand le fournisseur ne donne pas d’e-mail vérifié', async () => {
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

  // Audit du 2026-09-23 : le parseur WHATWG lit `\` comme `/` et retire tabulations et sauts de
  // ligne — chacune de ces formes se résolvait vers evil.example dans callback.ts::appRedirect.
  it.each([
    '/\\evil.example',
    '/\\/evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
    '/\u0000/evil.example',
    '/\u007f/evil.example',
    '/./\\evil.example',
    '/.//evil.example',
    '/x/..//evil.example',
  ])('rejette %j (redirection ouverte via normalisation d’URL)', (raw) => {
    const sanitized = sanitizeRedirectTo(raw);
    if (sanitized !== null) {
      // Si une forme passait, elle doit au moins rester sur NOTRE origine.
      expect(new URL(sanitized, 'https://wakfu.example/').origin).toBe('https://wakfu.example');
    }
    expect(sanitized).toBeNull();
  });

  it('renvoie la forme normalisée d’un chemin interne légitime', () => {
    expect(sanitizeRedirectTo('/pair?code=ABCD2345')).toBe('/pair?code=ABCD2345');
    expect(sanitizeRedirectTo('/fr/profil#stats')).toBe('/fr/profil#stats');
    expect(sanitizeRedirectTo('/a/../profil')).toBe('/profil');
    expect(sanitizeRedirectTo(`/${'a'.repeat(3000)}`)).toBeNull();
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

/**
 * Minimisation (RGPD art. 5.1.c, écart 4.4 de docs/analyse-rgpd.md) : la clé de
 * comptage dérivée de l'adresse IP ne doit jamais la laisser lire ni retrouver
 * sans le secret serveur.
 */
describe('clientIpKey', () => {
  function requestFrom(ip: string): Request {
    return new Request('https://example.test/api/v1/auth/discord/start', {
      headers: { 'cf-connecting-ip': ip },
    });
  }

  it("ne contient jamais l'adresse en clair et reste stable pour une même adresse", async () => {
    const env = { RATE_LIMIT_SALT: 'sel-de-test' };
    const key = await clientIpKey(requestFrom('203.0.113.7'), env);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(key).not.toContain('203.0.113.7');
    expect(await clientIpKey(requestFrom('203.0.113.7'), env)).toBe(key);
    expect(await clientIpKey(requestFrom('203.0.113.8'), env)).not.toBe(key);
  });

  it('dépend du secret : sans lui, la table ne permet pas de retrouver une adresse', async () => {
    const request = requestFrom('203.0.113.7');
    const salted = await clientIpKey(request, { RATE_LIMIT_SALT: 'sel-A' });
    expect(await clientIpKey(request, { RATE_LIMIT_SALT: 'sel-B' })).not.toBe(salted);
    // Repli sur DATABASE_URL quand aucun sel dédié n'est posé — en développement local seulement
    // (audit du 2026-09-23) : jamais un hachage non salé.
    const local = new Request('http://localhost:8788/api/v1/auth/discord/start', {
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    });
    expect(await clientIpKey(local, { DATABASE_URL: 'postgres://x' })).not.toBe(
      await clientIpKey(local, { DATABASE_URL: 'postgres://y' }),
    );
  });

  it("vaut 'unknown' haché quand Cloudflare ne transmet pas l'adresse", async () => {
    const env = { RATE_LIMIT_SALT: 'sel' };
    const key = await clientIpKey(new Request('https://example.test/'), env);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
  });
});

/**
 * Purge planifiée (`server/import/run-retention-purges.ts`, écart 4.13 de `docs/analyse-rgpd.md`) :
 * ce que les purges opportunistes laissent derrière elles quand le trafic d'authentification
 * s'arrête doit disparaître quand même.
 */
describe('runFullPurge', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('efface le compte inactif et la session morte, comme les purges de routes', async () => {
    const store = createMemoryAuthStore();
    const dormant = await login(store, { now: new Date(NOW.getTime() - 370 * DAY) });
    expect(dormant.ok).toBe(true);
    if (!dormant.ok) return;

    const report = await runFullPurge(store, NOW);
    expect(report.inactiveAccounts).toBe(1);
    expect(await store.findUserById(dormant.result.user.id)).toBeNull();
  });

  it('remet à zéro un compteur anti-abus dont la fenêtre est close', async () => {
    const store = createMemoryAuthStore();
    const closedWindow = new Date(NOW.getTime() - 30 * 60 * 1000);
    expect(await store.bumpRateLimit('auth:start:ip:abc', closedWindow)).toBe(1);

    await runFullPurge(store, NOW);

    // La ligne a disparu : le comptage repart de 1 au lieu de 2.
    expect(await store.bumpRateLimit('auth:start:ip:abc', closedWindow)).toBe(1);
  });

  it('laisse intacte la fenêtre de comptage en cours', async () => {
    const store = createMemoryAuthStore();
    const openWindow = new Date(NOW.getTime() - 60 * 1000);
    expect(await store.bumpRateLimit('auth:start:ip:abc', openWindow)).toBe(1);

    await runFullPurge(store, NOW);

    expect(await store.bumpRateLimit('auth:start:ip:abc', openWindow)).toBe(2);
  });

  it('déclenche aussi les purges sans effet observable : autorisations OAuth et appairages', async () => {
    const store = createMemoryAuthStore();
    const called: string[] = [];
    const spied: AuthStore = {
      ...store,
      purgeExpiredAuthorizations: async (now) => {
        called.push('authorizations');
        await store.purgeExpiredAuthorizations(now);
      },
      purgeExpiredPairings: async (now) => {
        called.push('pairings');
        await store.purgeExpiredPairings(now);
      },
    };

    await runFullPurge(spied, NOW);

    expect(called).toEqual(['authorizations', 'pairings']);
  });

  it('continue les purges suivantes quand une étape échoue, puis lève toutes les erreurs', async () => {
    const store = createMemoryAuthStore();
    const closedWindow = new Date(NOW.getTime() - 30 * 60 * 1000);
    await store.bumpRateLimit('auth:start:ip:abc', closedWindow);
    const failing: AuthStore = {
      ...store,
      purgeExpiredAuthorizations: async () => {
        throw new Error('base indisponible');
      },
    };

    const error = await runFullPurge(failing, NOW).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual([
      'autorisations OAuth : base indisponible',
    ]);
    // L'étape suivante a tourné malgré l'échec : le compteur de fenêtre close est parti.
    expect(await store.bumpRateLimit('auth:start:ip:abc', closedWindow)).toBe(1);
  });
});

/**
 * Durée de vie absolue (audit du 2026-09-23) : l'expiration glissante ne prolonge jamais une
 * session au-delà de SESSION_MAX_LIFETIME_MS après son ouverture.
 */
describe('durée de vie absolue des sessions', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('refuse une session au-delà de 180 jours, même utilisée chaque jour', async () => {
    const store = createMemoryAuthStore();
    const logged = await login(store, { now: NOW });
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;
    let last: Date = NOW;
    for (let d = 1; d * DAY < SESSION_MAX_LIFETIME_MS; d += 5) {
      last = new Date(NOW.getTime() + d * DAY);
      expect(await resolveSession(store, logged.result.token, last)).not.toBeNull();
    }
    const cap = new Date(NOW.getTime() + SESSION_MAX_LIFETIME_MS);
    expect(await resolveSession(store, logged.result.token, cap)).toBeNull();
  });

  it('plafonne la prolongation glissante à l’échéance absolue', async () => {
    const store = createMemoryAuthStore();
    const opened = await openSession(store, 'user-x', { now: NOW, userAgent: null });
    store.users.set('user-x', { id: 'user-x', email: null, displayName: null });
    const nearCap = new Date(NOW.getTime() + SESSION_MAX_LIFETIME_MS - 10 * DAY);
    // Session maintenue vivante jusque-là.
    for (let d = 20; d * DAY < SESSION_MAX_LIFETIME_MS - 10 * DAY; d += 20) {
      await resolveSession(store, opened.token, new Date(NOW.getTime() + d * DAY));
    }
    const resolved = await resolveSession(store, opened.token, nearCap);
    expect(resolved).not.toBeNull();
    expect(resolved?.session.expiresAt.getTime()).toBeLessThanOrEqual(
      NOW.getTime() + SESSION_MAX_LIFETIME_MS,
    );
    const stored = await store.findSession(opened.idHash);
    expect(stored?.absoluteExpiresAt).toEqual(new Date(NOW.getTime() + SESSION_MAX_LIFETIME_MS));
    expect(stored?.chainId).toBe(opened.idHash);
  });

  it('applique aussi le plafond à une ligne antérieure à la colonne (repli sur issuedAt)', async () => {
    const store = createMemoryAuthStore();
    const opened = await openSession(store, 'user-x', { now: NOW, userAgent: null });
    store.users.set('user-x', { id: 'user-x', email: null, displayName: null });
    const row = store.sessions.get(opened.idHash);
    if (!row) throw new Error('unreachable');
    row.absoluteExpiresAt = null;
    row.chainId = null;
    row.expiresAt = new Date(NOW.getTime() + SESSION_MAX_LIFETIME_MS + DAY);
    expect(
      await resolveSession(store, opened.token, new Date(NOW.getTime() + SESSION_MAX_LIFETIME_MS)),
    ).toBeNull();
  });
});

describe('minimisation et courses à la création de compte (audit du 2026-09-23)', () => {
  it('tronque un User-Agent démesuré', async () => {
    const store = createMemoryAuthStore();
    const user = await store.createUser({ email: null, displayName: null });
    const opened = await openSession(store, user.id, { now: NOW, userAgent: 'x'.repeat(10_000) });
    expect((await store.findSession(opened.idHash))?.userAgent).toHaveLength(MAX_USER_AGENT_LENGTH);
  });

  it('met à jour l’e-mail de l’identité quand il change chez le fournisseur', async () => {
    const store = createMemoryAuthStore();
    await login(store);
    await login(store, { oauthProfile: profile({ email: 'nouvelle@example.com' }) });
    expect((await store.findIdentity('discord', 'uid-1'))?.email).toBe('nouvelle@example.com');
  });

  it('course sur l’e-mail : la seconde connexion rejoint le compte créé par la première', async () => {
    const store = createMemoryAuthStore();
    let winnerId = '';
    let identityLookups = 0;
    const racing: AuthStore = {
      ...store,
      // Le premier SELECT ne voit encore rien ; la requête concurrente a déjà tout écrit ensuite.
      findIdentity: async (provider, uid) =>
        identityLookups++ === 0 ? null : store.findIdentity(provider, uid),
      findUserByEmail: async () => null,
      createUser: async () => {
        const winner = await store.createUser({ email: 'joueur@example.com', displayName: null });
        await store.linkIdentity({
          userId: winner.id,
          provider: 'discord',
          providerUid: 'uid-1',
          email: 'joueur@example.com',
          now: NOW,
        });
        winnerId = winner.id;
        throw new Error('duplicate key value violates unique constraint "users_email_key"');
      },
    };
    const result = await login(racing);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.user.id).toBe(winnerId);
  });

  it('course sans e-mail : pas de compte orphelin, l’identité reste au premier compte', async () => {
    const store = createMemoryAuthStore();
    const first = await store.createUser({ email: null, displayName: null });
    await store.linkIdentity({
      userId: first.id,
      provider: 'discord',
      providerUid: 'uid-1',
      email: null,
      now: NOW,
    });
    let lookups = 0;
    const racing: AuthStore = {
      ...store,
      findIdentity: async (provider, uid) =>
        lookups++ === 0 ? null : store.findIdentity(provider, uid),
    };
    const result = await login(racing, { oauthProfile: profile({ email: null }) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.user.id).toBe(first.id);
    expect(store.users.size).toBe(1);
  });
});
