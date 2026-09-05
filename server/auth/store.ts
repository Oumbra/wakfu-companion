/**
 * Port de persistance de l'authentification (lot 5, prompt 5.1).
 *
 * Pourquoi une interface plutôt que des appels drizzle directs dans le flux :
 * la logique sensible (validation du `state`, usage unique du code, fusion de
 * comptes, révocation) doit être testable **sans base Postgres ni réseau** —
 * exigence de tests du prompt 5.1. `server/auth/flow.ts` ne connaît que ce
 * port ; `server/auth/db-store.ts` en est l'implémentation drizzle/Neon, et
 * les tests en fournissent une implémentation mémoire.
 *
 * Toutes les dates sont des `Date` absolues fournies par l'appelant (`now`) :
 * aucun appel à `Date.now()` dans le flux lui-même, pour que les tests
 * puissent simuler une expiration sans attendre.
 */

export type ProviderId = 'discord' | 'google';

export interface AuthorizationRecord {
  /** Le `state` OAuth (opaque, 256 bits) — sert aussi de clé primaire. */
  state: string;
  provider: ProviderId;
  codeVerifier: string;
  /** Chemin interne de retour après connexion (jamais une URL absolue, voir flow.ts). */
  redirectTo: string | null;
  expiresAt: Date;
}

export interface SessionRecord {
  /** SHA-256 du jeton de session — le jeton lui-même n'est jamais stocké. */
  idHash: string;
  userId: string;
  issuedAt: Date;
  expiresAt: Date;
  lastUsedAt: Date;
  userAgent: string | null;
  revokedAt: Date | null;
}

export interface UserRecord {
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface IdentityRecord {
  provider: ProviderId;
  providerUid: string;
  userId: string;
  email: string | null;
  linkedAt: Date;
}

/** Appairage natif en cours (voir `server/auth/pairing.ts` et `nativePairings`). */
export interface PairingRecord {
  deviceCode: string;
  userCode: string;
  expiresAt: Date;
}

export type PollPairingResult =
  { status: 'claimed'; token: string } | { status: 'pending' | 'expired' };

export interface AuthStore {
  // ── Autorisations OAuth en cours ──────────────────────────────────────
  createAuthorization(record: AuthorizationRecord): Promise<void>;
  /**
   * Marque l'autorisation comme consommée et la renvoie — **atomiquement**
   * (un seul `UPDATE ... WHERE consumed_at IS NULL ... RETURNING`), ce qui
   * fait échouer tout rejeu du même `state`/`code`. Renvoie `null` si le
   * `state` est inconnu, expiré, ou déjà consommé.
   */
  consumeAuthorization(state: string, now: Date): Promise<AuthorizationRecord | null>;
  purgeExpiredAuthorizations(now: Date): Promise<void>;

  // ── Comptes et identités ──────────────────────────────────────────────
  findIdentity(provider: ProviderId, providerUid: string): Promise<IdentityRecord | null>;
  listIdentities(userId: string): Promise<IdentityRecord[]>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(userId: string): Promise<UserRecord | null>;
  createUser(input: { email: string | null; displayName: string | null }): Promise<UserRecord>;
  linkIdentity(input: {
    userId: string;
    provider: ProviderId;
    providerUid: string;
    email: string | null;
    now: Date;
  }): Promise<void>;
  updateUser(
    userId: string,
    patch: { email?: string | null; displayName?: string | null; lastSeenAt?: Date },
  ): Promise<void>;
  deleteUser(userId: string): Promise<void>;

  // ── Sessions ──────────────────────────────────────────────────────────
  createSession(record: SessionRecord): Promise<void>;
  findSession(idHash: string): Promise<SessionRecord | null>;
  touchSession(idHash: string, patch: { lastUsedAt: Date; expiresAt: Date }): Promise<void>;
  revokeSession(idHash: string, now: Date): Promise<boolean>;
  /** Révoque toutes les sessions actives d'un compte, sauf éventuellement une. */
  revokeAllSessions(userId: string, now: Date, exceptIdHash?: string): Promise<number>;
  listSessions(userId: string, now: Date): Promise<SessionRecord[]>;

  // ── Limitation de débit ───────────────────────────────────────────────
  /** Incrémente le compteur de la fenêtre et renvoie sa valeur APRÈS incrément. */
  bumpRateLimit(bucket: string, windowStart: Date): Promise<number>;
  purgeRateLimits(before: Date): Promise<void>;

  // ── Appairage natif (overlay) ──────────────────────────────────────────
  createPairing(record: PairingRecord): Promise<void>;
  /**
   * Associe un jeton de session (déjà créé par l'appelant via
   * `createSession`) au code — **atomiquement**, uniquement si le code est
   * connu, pas expiré et pas déjà réclamé. Renvoie `false` sinon (code
   * inconnu/expiré/déjà utilisé), à traduire en 404 par la route.
   */
  claimPairing(userCode: string, sessionToken: string, now: Date): Promise<boolean>;
  /**
   * Renvoie le jeton et marque l'appairage consommé — **atomiquement**, une
   * seule fois (`UPDATE ... WHERE consumed_at IS NULL ... RETURNING`) : un
   * second `poll` du même `deviceCode` ne revoit jamais le jeton.
   */
  pollPairing(deviceCode: string, now: Date): Promise<PollPairingResult>;
  purgeExpiredPairings(now: Date): Promise<void>;
}
