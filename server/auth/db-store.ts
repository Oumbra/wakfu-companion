/**
 * Implémentation Postgres/drizzle du port `AuthStore` (lot 5, prompt 5.1).
 * Aucune logique métier ici : les décisions (validité du `state`, fusion de
 * comptes, rotation de session) vivent dans server/auth/flow.ts, testé sans
 * base — ce fichier n'est que la traduction SQL du port.
 *
 * ⚠ Le driver `neon-http` n'offre pas de transaction interactive (voir
 * server/db/client.ts) : toute opération devant être atomique est écrite
 * comme UNE requête SQL. C'est en particulier le cas de
 * `consumeAuthorization` (usage unique du `code`) et de `bumpRateLimit`
 * (compteur), qui seraient sinon sujets à une course entre deux requêtes
 * concurrentes.
 */

import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  authRateLimits,
  nativePairings,
  oauthAuthorizations,
  sessions,
  userIdentities,
  users,
} from '../db/schema';
import type {
  AuthStore,
  AuthorizationRecord,
  IdentityRecord,
  PairingRecord,
  ProviderId,
  SessionRecord,
  UserRecord,
} from './store';

export function createDbAuthStore(db: Db): AuthStore {
  return {
    async createAuthorization(record: AuthorizationRecord) {
      await db.insert(oauthAuthorizations).values({
        id: record.state,
        provider: record.provider,
        codeVerifier: record.codeVerifier,
        redirectTo: record.redirectTo,
        expiresAt: record.expiresAt,
      });
    },

    async consumeAuthorization(state: string, now: Date) {
      // Une seule requête : le `WHERE consumed_at IS NULL` fait que deux
      // callbacks concurrents portant le même `state` ne peuvent pas réussir
      // tous les deux (le second met à jour 0 ligne).
      const [row] = await db
        .update(oauthAuthorizations)
        .set({ consumedAt: now })
        .where(
          and(
            eq(oauthAuthorizations.id, state),
            isNull(oauthAuthorizations.consumedAt),
            gt(oauthAuthorizations.expiresAt, now),
          ),
        )
        .returning();
      if (!row) return null;
      return {
        state: row.id,
        provider: row.provider as ProviderId,
        codeVerifier: row.codeVerifier,
        redirectTo: row.redirectTo,
        expiresAt: row.expiresAt,
      };
    },

    async purgeExpiredAuthorizations(now: Date) {
      await db.delete(oauthAuthorizations).where(lt(oauthAuthorizations.expiresAt, now));
    },

    async findIdentity(provider: ProviderId, providerUid: string) {
      const [row] = await db
        .select()
        .from(userIdentities)
        .where(
          and(eq(userIdentities.provider, provider), eq(userIdentities.providerUid, providerUid)),
        )
        .limit(1);
      return row ? toIdentity(row) : null;
    },

    async listIdentities(userId: string) {
      const rows = await db.select().from(userIdentities).where(eq(userIdentities.userId, userId));
      return rows.map(toIdentity);
    },

    async findUserByEmail(email: string) {
      const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return row ? toUser(row) : null;
    },

    async findUserById(userId: string) {
      const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      return row ? toUser(row) : null;
    },

    async createUser(input) {
      const [row] = await db
        .insert(users)
        .values({ email: input.email, displayName: input.displayName })
        .returning();
      return toUser(row);
    },

    async linkIdentity(input) {
      await db
        .insert(userIdentities)
        .values({
          userId: input.userId,
          provider: input.provider,
          providerUid: input.providerUid,
          email: input.email,
          linkedAt: input.now,
        })
        .onConflictDoUpdate({
          target: [userIdentities.provider, userIdentities.providerUid],
          set: { userId: input.userId, email: input.email },
        });
    },

    async updateUser(userId, patch) {
      if (Object.keys(patch).length === 0) return;
      await db.update(users).set(patch).where(eq(users.id, userId));
    },

    async deleteUser(userId) {
      // Les identités et sessions partent en cascade (ON DELETE CASCADE, §7 :
      // « suppression du compte avec effet réel »).
      await db.delete(users).where(eq(users.id, userId));
    },

    async createSession(record: SessionRecord) {
      await db.insert(sessions).values({
        id: record.idHash,
        userId: record.userId,
        issuedAt: record.issuedAt,
        expiresAt: record.expiresAt,
        lastUsedAt: record.lastUsedAt,
        userAgent: record.userAgent,
        revokedAt: record.revokedAt,
      });
    },

    async findSession(idHash: string) {
      const [row] = await db.select().from(sessions).where(eq(sessions.id, idHash)).limit(1);
      return row ? toSession(row) : null;
    },

    async touchSession(idHash, patch) {
      await db
        .update(sessions)
        .set({ lastUsedAt: patch.lastUsedAt, expiresAt: patch.expiresAt })
        .where(eq(sessions.id, idHash));
    },

    async revokeSession(idHash, now) {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.id, idHash), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.length > 0;
    },

    async revokeAllSessions(userId, now, exceptIdHash) {
      const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
      if (exceptIdHash) conditions.push(sql`${sessions.id} <> ${exceptIdHash}`);
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(...conditions))
        .returning({ id: sessions.id });
      return rows.length;
    },

    async listSessions(userId, now) {
      const rows = await db
        .select()
        .from(sessions)
        .where(
          and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)),
        );
      return rows.map(toSession);
    },

    async bumpRateLimit(bucket, windowStart) {
      const [row] = await db
        .insert(authRateLimits)
        .values({ bucket, windowStart, count: 1 })
        .onConflictDoUpdate({
          target: [authRateLimits.bucket, authRateLimits.windowStart],
          set: { count: sql`${authRateLimits.count} + 1` },
        })
        .returning({ count: authRateLimits.count });
      return row?.count ?? 1;
    },

    async purgeRateLimits(before: Date) {
      await db.delete(authRateLimits).where(lt(authRateLimits.windowStart, before));
    },

    async createPairing(record: PairingRecord) {
      await db.insert(nativePairings).values({
        deviceCode: record.deviceCode,
        userCode: record.userCode,
        expiresAt: record.expiresAt,
      });
    },

    async claimPairing(userCode: string, sessionToken: string, now: Date) {
      // Une seule requête : `claimed_at IS NULL` empêche deux `/claim` concurrents sur le même
      // code de réussir tous les deux (même principe que `consumeAuthorization`).
      const rows = await db
        .update(nativePairings)
        .set({ sessionToken, claimedAt: now })
        .where(
          and(
            eq(nativePairings.userCode, userCode),
            isNull(nativePairings.claimedAt),
            gt(nativePairings.expiresAt, now),
          ),
        )
        .returning({ deviceCode: nativePairings.deviceCode });
      return rows.length > 0;
    },

    async pollPairing(deviceCode: string, now: Date) {
      const [row] = await db
        .select()
        .from(nativePairings)
        .where(eq(nativePairings.deviceCode, deviceCode))
        .limit(1);
      if (!row || row.expiresAt.getTime() <= now.getTime()) return { status: 'expired' as const };
      // Vérifié AVANT le statut pending/claimed : une fois consommé, `sessionToken` est effacé,
      // donc indiscernable d'un appairage encore pending si on ne teste pas `consumedAt` en 1er.
      if (row.consumedAt !== null) return { status: 'expired' as const };
      if (!row.sessionToken || !row.claimedAt) return { status: 'pending' as const };
      // Le jeton est déjà en main (row.sessionToken, lu ci-dessus) : cette 2ᵉ requête ne sert
      // qu'à garantir qu'il n'est renvoyé qu'UNE fois — `consumed_at IS NULL` fait échouer tout
      // second `/poll` concurrent ou rejoué (0 ligne affectée), même principe que
      // `consumeAuthorization`.
      const rows = await db
        .update(nativePairings)
        .set({ sessionToken: null, consumedAt: now })
        .where(and(eq(nativePairings.deviceCode, deviceCode), isNull(nativePairings.consumedAt)))
        .returning({ deviceCode: nativePairings.deviceCode });
      if (rows.length === 0) return { status: 'expired' as const }; // déjà consommé par un poll précédent
      return { status: 'claimed' as const, token: row.sessionToken };
    },

    async purgeExpiredPairings(now: Date) {
      await db.delete(nativePairings).where(lt(nativePairings.expiresAt, now));
    },
  };
}

function toUser(row: typeof users.$inferSelect): UserRecord {
  return { id: row.id, email: row.email, displayName: row.displayName };
}

function toIdentity(row: typeof userIdentities.$inferSelect): IdentityRecord {
  return {
    provider: row.provider as ProviderId,
    providerUid: row.providerUid,
    userId: row.userId,
    email: row.email,
    linkedAt: row.linkedAt,
  };
}

function toSession(row: typeof sessions.$inferSelect): SessionRecord {
  return {
    idHash: row.id,
    userId: row.userId,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    userAgent: row.userAgent,
    revokedAt: row.revokedAt,
  };
}
