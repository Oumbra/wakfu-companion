/**
 * Implémentation mémoire du port `AuthStore` — utilisée par les tests
 * (server/auth/flow.spec.ts) pour valider la logique d'authentification sans
 * base Postgres ni réseau, comme le demande le prompt 5.1.
 *
 * Elle n'est jamais chargée par les Pages Functions (aucune route ne
 * l'importe) : le déploiement embarque uniquement `db-store.ts`.
 *
 * Elle reproduit fidèlement les deux garanties d'atomicité de
 * l'implémentation SQL — usage unique de l'autorisation
 * (`consumeAuthorization`) et incrément du compteur de débit — pour que les
 * tests portent sur le même comportement que la production.
 */

import type {
  AuthStore,
  AuthorizationRecord,
  IdentityRecord,
  PairingRecord,
  ProviderId,
  SessionRecord,
  UserRecord,
} from './store';

interface StoredAuthorization extends AuthorizationRecord {
  consumedAt: Date | null;
}

interface StoredPairing extends PairingRecord {
  sessionToken: string | null;
  claimedAt: Date | null;
  consumedAt: Date | null;
}

export interface MemoryAuthStore extends AuthStore {
  /** Accès direct pour les assertions de test. */
  readonly users: Map<string, UserRecord>;
  readonly identities: Map<string, IdentityRecord>;
  readonly sessions: Map<string, SessionRecord>;
}

export function createMemoryAuthStore(): MemoryAuthStore {
  const authorizations = new Map<string, StoredAuthorization>();
  const users = new Map<string, UserRecord>();
  const identities = new Map<string, IdentityRecord>();
  const sessions = new Map<string, SessionRecord>();
  const rateLimits = new Map<string, number>();
  const pairings = new Map<string, StoredPairing>(); // clé : deviceCode
  let nextUserId = 1;

  const identityKey = (provider: ProviderId, providerUid: string) => `${provider}:${providerUid}`;
  const rateKey = (bucket: string, windowStart: Date) => `${bucket}@${windowStart.toISOString()}`;

  return {
    users,
    identities,
    sessions,

    async createAuthorization(record) {
      authorizations.set(record.state, { ...record, consumedAt: null });
    },

    async consumeAuthorization(state, now) {
      const row = authorizations.get(state);
      if (!row) return null;
      if (row.consumedAt !== null) return null; // rejeu
      if (row.expiresAt.getTime() <= now.getTime()) return null;
      row.consumedAt = now;
      return {
        state: row.state,
        provider: row.provider,
        codeVerifier: row.codeVerifier,
        redirectTo: row.redirectTo,
        expiresAt: row.expiresAt,
      };
    },

    async purgeExpiredAuthorizations(now) {
      for (const [state, row] of authorizations) {
        if (row.expiresAt.getTime() < now.getTime()) authorizations.delete(state);
      }
    },

    async findIdentity(provider, providerUid) {
      return identities.get(identityKey(provider, providerUid)) ?? null;
    },

    async listIdentities(userId) {
      return [...identities.values()].filter((identity) => identity.userId === userId);
    },

    async findUserByEmail(email) {
      return [...users.values()].find((user) => user.email === email) ?? null;
    },

    async findUserById(userId) {
      return users.get(userId) ?? null;
    },

    async createUser(input) {
      const user: UserRecord = {
        id: `user-${nextUserId++}`,
        email: input.email,
        displayName: input.displayName,
      };
      users.set(user.id, user);
      return user;
    },

    async linkIdentity(input) {
      identities.set(identityKey(input.provider, input.providerUid), {
        provider: input.provider,
        providerUid: input.providerUid,
        userId: input.userId,
        email: input.email,
        linkedAt: input.now,
      });
    },

    async updateUser(userId, patch) {
      const user = users.get(userId);
      if (!user) return;
      if (patch.email !== undefined) user.email = patch.email;
      if (patch.displayName !== undefined) user.displayName = patch.displayName;
    },

    async deleteUser(userId) {
      users.delete(userId);
      for (const [key, identity] of identities) {
        if (identity.userId === userId) identities.delete(key);
      }
      for (const [key, session] of sessions) {
        if (session.userId === userId) sessions.delete(key);
      }
    },

    async createSession(record) {
      sessions.set(record.idHash, { ...record });
    },

    async findSession(idHash) {
      const session = sessions.get(idHash);
      return session ? { ...session } : null;
    },

    async touchSession(idHash, patch) {
      const session = sessions.get(idHash);
      if (!session) return;
      session.lastUsedAt = patch.lastUsedAt;
      session.expiresAt = patch.expiresAt;
    },

    async revokeSession(idHash, now) {
      const session = sessions.get(idHash);
      if (!session || session.revokedAt !== null) return false;
      session.revokedAt = now;
      return true;
    },

    async revokeAllSessions(userId, now, exceptIdHash) {
      let revoked = 0;
      for (const session of sessions.values()) {
        if (session.userId !== userId || session.revokedAt !== null) continue;
        if (exceptIdHash && session.idHash === exceptIdHash) continue;
        session.revokedAt = now;
        revoked++;
      }
      return revoked;
    },

    async listSessions(userId, now) {
      return [...sessions.values()]
        .filter(
          (session) =>
            session.userId === userId &&
            session.revokedAt === null &&
            session.expiresAt.getTime() > now.getTime(),
        )
        .map((session) => ({ ...session }));
    },

    async bumpRateLimit(bucket, windowStart) {
      const key = rateKey(bucket, windowStart);
      const next = (rateLimits.get(key) ?? 0) + 1;
      rateLimits.set(key, next);
      return next;
    },

    async purgeRateLimits(before) {
      for (const key of rateLimits.keys()) {
        const windowStart = new Date(key.slice(key.lastIndexOf('@') + 1));
        if (windowStart.getTime() < before.getTime()) rateLimits.delete(key);
      }
    },

    async createPairing(record) {
      pairings.set(record.deviceCode, {
        ...record,
        sessionToken: null,
        claimedAt: null,
        consumedAt: null,
      });
    },

    async claimPairing(userCode, sessionToken, now) {
      const row = [...pairings.values()].find((p) => p.userCode === userCode);
      if (!row) return false;
      if (row.claimedAt !== null) return false; // déjà réclamé
      if (row.expiresAt.getTime() <= now.getTime()) return false;
      row.sessionToken = sessionToken;
      row.claimedAt = now;
      return true;
    },

    async pollPairing(deviceCode, now) {
      const row = pairings.get(deviceCode);
      if (!row || row.expiresAt.getTime() <= now.getTime()) return { status: 'expired' };
      // Vérifié AVANT le statut pending/claimed : une fois consommé, `sessionToken` est effacé,
      // donc indiscernable d'un appairage encore pending si on ne teste pas `consumedAt` en 1er.
      if (row.consumedAt !== null) return { status: 'expired' }; // déjà consommé par un poll précédent
      if (!row.sessionToken || !row.claimedAt) return { status: 'pending' };
      row.consumedAt = now;
      const token = row.sessionToken;
      row.sessionToken = null;
      return { status: 'claimed', token };
    },

    async purgeExpiredPairings(now) {
      for (const [deviceCode, row] of pairings) {
        if (row.expiresAt.getTime() < now.getTime()) pairings.delete(deviceCode);
      }
    },
  };
}
