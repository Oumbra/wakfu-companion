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
  /**
   * Remplacée par une session plus récente (rotation du jeton natif, voir
   * `server/auth/pairing.ts::rotateNativeSession`). Encore acceptée jusqu'à
   * `expiresAt` — ramené à une courte grâce au moment de la rotation — mais
   * plus jamais prolongée par l'expiration glissante ni listée parmi les
   * sessions actives : la nouvelle session la représente.
   */
  supersededAt: Date | null;
  /**
   * Chaîne de rotation (audit du 2026-09-23) : empreinte de la PREMIÈRE session de la chaîne
   * (connexion ou appairage), recopiée à chaque rotation native. Permet de révoquer d'un coup
   * toutes les sessions issues d'un même appairage quand une rotation suspecte est détectée.
   * `null` pour une ligne antérieure à la colonne : `sessionChainId` (flow.ts) retombe alors sur
   * `idHash`.
   */
  chainId: string | null;
  /**
   * Échéance absolue (`SESSION_MAX_LIFETIME_MS` après l'ouverture de la chaîne), jamais dépassée
   * par l'expiration glissante ni par une rotation. `null` pour une ligne antérieure à la colonne
   * (voir `sessionAbsoluteExpiry`, flow.ts).
   */
  absoluteExpiresAt: Date | null;
  /**
   * Date à laquelle cette session, DÉJÀ remplacée, a servi à une rotation de rattrapage (overlay
   * planté entre la réponse de rotation et l'écriture du nouveau jeton). Une seule fois : une
   * seconde tentative révoque toute la chaîne (voir `rotateNativeSession`).
   */
  graceRotatedAt: Date | null;
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
  /** Date de la demande (sert à afficher son âge sur la page `/pair`). */
  createdAt: Date;
  /**
   * Pays de l'appareil demandeur tel que vu par Cloudflare (`cf-ipcountry`, code ISO à deux
   * lettres) — jamais l'adresse IP. Affiché sur la page `/pair` pour que l'utilisateur repère une
   * demande qui ne vient pas de chez lui (hameçonnage par code d'appairage). Vit le temps de
   * l'appairage (`PAIRING_TTL_MS`), purgé avec la ligne.
   */
  requesterCountry: string | null;
  /** User-agent de l'appareil demandeur, tronqué (`MAX_REQUESTER_USER_AGENT_LENGTH`, pairing.ts). */
  requesterUserAgent: string | null;
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
  }): Promise<string>;
  /**
   * Met à jour l'e-mail d'une identité existante (il suit celui du fournisseur à chaque connexion :
   * exactitude, RGPD art. 5.1.d).
   */
  updateIdentityEmail(
    provider: ProviderId,
    providerUid: string,
    email: string | null,
  ): Promise<void>;
  updateUser(
    userId: string,
    patch: { email?: string | null; displayName?: string | null; lastSeenAt?: Date },
  ): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  /**
   * **Efface** (en cascade : identités, sessions, configuration, historique)
   * les comptes dont `lastSeenAt` est antérieur à `before` — limitation de la
   * conservation (RGPD art. 5.1.e). Le délai est fixé par l'appelant
   * (`INACTIVE_ACCOUNT_RETENTION_MS`, flow.ts) et annoncé dans la politique de
   * confidentialité (§5). Renvoie le nombre de comptes effacés.
   */
  purgeInactiveUsers(before: Date): Promise<number>;

  // ── Sessions ──────────────────────────────────────────────────────────
  createSession(record: SessionRecord): Promise<void>;
  findSession(idHash: string): Promise<SessionRecord | null>;
  touchSession(idHash: string, patch: { lastUsedAt: Date; expiresAt: Date }): Promise<void>;
  revokeSession(idHash: string, now: Date): Promise<boolean>;
  /**
   * **Efface** la ligne de session, au lieu de la marquer révoquée — droit à l'effacement
   * (RGPD art. 17) exercé depuis un client natif, voir
   * `functions/api/v1/auth/native/session.ts`.
   *
   * Une session révoquée reste en base (`revoked_at`), ce qui est le bon défaut : elle documente
   * qu'un appareil a été déconnecté, et `resolveSession` la refuse de toute façon. Mais quand
   * l'utilisateur demande l'effacement de ce que l'overlay a laissé, cette trace-là — son
   * `user_id`, ses horodatages, son `user_agent` — fait partie de ce qui doit partir. Le jeton
   * devient inutilisable dans les deux cas : inconnu et révoqué donnent le même 401.
   *
   * `false` si la ligne n'existait pas (jeton déjà effacé, appel rejoué).
   */
  deleteSession(idHash: string): Promise<boolean>;
  /**
   * Marque la session comme remplacée (rotation du jeton natif) : pose
   * `supersededAt` et RACCOURCIT `expiresAt` à la fin de grâce fournie.
   *
   * Avec `onlyIfCurrent` (rotation ordinaire), **atomiquement** et seulement si la session n'est
   * pas déjà remplacée (`UPDATE ... WHERE superseded_at IS NULL RETURNING`, audit du 2026-09-23,
   * #7) : de deux rotations concurrentes du même jeton, une seule peut réussir. Sans (rotation de
   * rattrapage, déjà sérialisée par `markGraceRotation`), l'écriture est inconditionnelle.
   *
   * `false` si aucune ligne n'a été modifiée (inconnue, ou déjà remplacée avec `onlyIfCurrent`).
   */
  supersedeSession(
    idHash: string,
    patch: { supersededAt: Date; expiresAt: Date; onlyIfCurrent: boolean },
  ): Promise<boolean>;
  /**
   * Révoque toutes les sessions non révoquées d'une chaîne de rotation (`chain_id = chainId`, ou
   * `id = chainId` pour la racine d'une chaîne antérieure à la colonne), sauf éventuellement une.
   * Renvoie le nombre de sessions révoquées.
   */
  revokeSessionChain(chainId: string, now: Date, exceptIdHash?: string): Promise<number>;
  /**
   * Pose `graceRotatedAt` — **atomiquement**, seulement s'il est encore nul (`UPDATE ... WHERE
   * grace_rotated_at IS NULL RETURNING`). `false` si la session a déjà servi à une rotation de
   * rattrapage (ou n'existe pas) : deux rattrapages concurrents ne peuvent pas réussir tous les deux.
   */
  markGraceRotation(idHash: string, now: Date): Promise<boolean>;
  /** Révoque toutes les sessions actives d'un compte, sauf éventuellement une. */
  revokeAllSessions(userId: string, now: Date, exceptIdHash?: string): Promise<number>;
  /** Sessions actives d'un compte : ni révoquées, ni expirées, ni remplacées. */
  listSessions(userId: string, now: Date): Promise<SessionRecord[]>;
  /**
   * **Efface** les sessions mortes depuis longtemps : expirées avant `before`
   * ou révoquées avant `before` — limitation de la conservation (RGPD
   * art. 5.1.e). Une session révoquée garde sa ligne un temps (elle documente
   * qu'un appareil a été déconnecté, utile pour comprendre un incident), pas
   * pour toujours : `resolveSession` la refuse de toute façon, et elle
   * n'apparaît plus dans « Mon compte ». Renvoie le nombre de lignes effacées.
   * Le délai est fixé par l'appelant (`DEAD_SESSION_RETENTION_MS`, flow.ts).
   */
  purgeDeadSessions(before: Date): Promise<number>;

  // ── Limitation de débit ───────────────────────────────────────────────
  /** Incrémente le compteur de la fenêtre et renvoie sa valeur APRÈS incrément. */
  /** Incrémente le compteur de `amount` (1 par défaut : une requête ; un nombre d'octets pour les
   * budgets en volume, voir `server/http/api-guards.ts`) et rend sa nouvelle valeur. */
  bumpRateLimit(bucket: string, windowStart: Date, amount?: number): Promise<number>;
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
  /**
   * Efface les appairages expirés — ET les sessions nées d'un appairage réclamé mais jamais sondé
   * (audit du 2026-09-23, #9) : `claimPairing` crée la session au moment de la confirmation dans le
   * navigateur, mais son jeton n'est remis à l'overlay que par `/poll`. Un appairage expiré dont
   * le jeton n'a jamais été remis (`session_token` encore présent, `consumed_at` nul) laissait une
   * session vivante 30 jours, rattachée au compte, que personne ne détenait — et listée dans
   * « Mon compte ». Passé l'expiration, `/poll` ne peut plus la remettre : elle est effacée.
   */
  purgeExpiredPairings(now: Date): Promise<void>;
  /**
   * Appairage encore EN ATTENTE (ni réclamé, ni expiré) pour ce code — sert à la page `/pair`
   * (`GET /api/v1/auth/native/pairing`) à montrer d'où vient la demande avant confirmation.
   * `null` sinon. Ne renvoie jamais le `deviceCode` à l'appelant de la route.
   */
  findPendingPairing(userCode: string, now: Date): Promise<PairingRecord | null>;
}
