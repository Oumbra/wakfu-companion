/**
 * Cœur du flux d'authentification (lot 5, prompt 5.1) — indépendant de
 * Cloudflare, de Postgres et du réseau : tout passe par le port `AuthStore`
 * (server/auth/store.ts) et par un `ProfileFetcher` injecté. C'est ce qui
 * rend testables sans infrastructure les quatre exigences du prompt : `state`
 * invalide rejeté, code réutilisé rejeté, session révoquée refusée, e-mail
 * vérifié d'un compte existant refusé à un autre fournisseur (un compte = un
 * seul fournisseur, voir `resolveAccount`).
 *
 * Décisions structurantes de ce flux : OAuth uniquement, cookie opaque,
 * sessions en base, mode invité intact (voir server/README.md).
 */

import { pkceChallenge, randomToken, sha256Hex, timingSafeEqual } from './crypto';
import { OAUTH_STATE_TTL_MS, SESSION_TTL_MS } from './cookies';
import type { OAuthProfile } from './providers';
import { MAX_RATE_LIMIT_WINDOW_MS } from './rate-limit';
import type { AuthStore, ProviderId, SessionRecord, UserRecord } from './store';

/**
 * Au-delà de ce délai restant, on ne réécrit pas la ligne de session : sans
 * ce seuil, l'expiration glissante ferait un `UPDATE` à chaque requête
 * authentifiée pour un gain nul.
 */
const SESSION_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Durée de vie ABSOLUE d'une session, quelle que soit l'activité (audit de sécurité du
 * 2026-09-23) : l'expiration glissante de 30 jours seule laissait un jeton volé — ou une chaîne de
 * rotations natives — vivre indéfiniment tant qu'il servait. Comptée depuis l'ouverture initiale
 * (connexion OAuth ou appairage natif) et **propagée** aux rotations (`rotateNativeSession`) :
 * une rotation renouvelle le jeton, pas le droit de rester connecté. Passé ce délai, l'utilisateur
 * se reconnecte (site) ou réappaire l'overlay. Colonne `sessions.absolute_expires_at`.
 */
export const SESSION_MAX_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Échéance absolue d'une session. `absoluteExpiresAt` est nul pour une ligne écrite par du code
 * antérieur à la colonne (fenêtre entre migration et déploiement) : repli sur `issuedAt`.
 */
export function sessionAbsoluteExpiry(session: SessionRecord): Date {
  return (
    session.absoluteExpiresAt ?? new Date(session.issuedAt.getTime() + SESSION_MAX_LIFETIME_MS)
  );
}

/** Chaîne de rotation d'une session (repli sur son propre identifiant, même raison que ci-dessus). */
export function sessionChainId(session: SessionRecord): string {
  return session.chainId ?? session.idHash;
}

/**
 * Délai au bout duquel une session **morte** (expirée ou révoquée) est effacée
 * de la table — limitation de la conservation (RGPD art. 5.1.e). Ces lignes
 * n'ouvrent plus rien (`resolveSession` les refuse) et n'apparaissent plus
 * dans « Mon compte » ; on les garde le temps de pouvoir relire un incident
 * (« cet appareil s'était déconnecté quand ? »), pas au-delà. Annoncé dans la
 * politique de confidentialité (section 5) : ne pas changer l'un sans l'autre.
 */
export const DEAD_SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Délai d'inactivité au bout duquel un **compte** est effacé, avec tout ce qui
 * lui est rattaché (identités, sessions, configuration, historique) —
 * limitation de la conservation (RGPD art. 5.1.e), décision du responsable de
 * traitement du 2026-09-20. « Inactif » = aucune activité authentifiée
 * (`users.last_seen_at`) : ni connexion OAuth, ni requête d'une session web ou
 * overlay (le rafraîchissement quotidien de `resolveSession` compte). Annoncé
 * dans la politique de confidentialité (section 5) : ne pas changer l'un sans
 * l'autre. Pas de courriel d'avertissement : le service n'envoie aucun
 * courriel (aucun prestataire d'envoi), l'information passe par la politique.
 */
export const INACTIVE_ACCOUNT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Ménage opportuniste des sessions mortes — Cloudflare Pages n'a pas de Cron
 * Trigger (voir server/README.md), donc, comme pour les autorisations OAuth
 * et les appairages, on le fait à l'occasion d'appels qui touchent déjà à la
 * table : connexion, appairage natif, rotation, consultation des appareils,
 * et le rafraîchissement quotidien de l'expiration glissante (seul déclencheur
 * pour un compte qui ne se reconnecte jamais mais dont l'overlay tourne).
 */
export function purgeDeadSessions(store: AuthStore, now: Date): Promise<number> {
  return store.purgeDeadSessions(new Date(now.getTime() - DEAD_SESSION_RETENTION_MS));
}

/** Efface les comptes sans activité depuis `INACTIVE_ACCOUNT_RETENTION_MS`. */
export function purgeInactiveAccounts(store: AuthStore, now: Date): Promise<number> {
  return store.purgeInactiveUsers(new Date(now.getTime() - INACTIVE_ACCOUNT_RETENTION_MS));
}

/**
 * Les deux purges de conservation, dans l'ordre (un compte inactif emporte ses
 * sessions par cascade). Toujours appeler APRÈS avoir marqué l'activité du
 * compte courant (`lastSeenAt`), jamais avant : c'est ce qui garantit qu'un
 * compte ne peut pas être purgé par sa propre requête de retour.
 */
export async function runRetentionPurges(store: AuthStore, now: Date): Promise<void> {
  await purgeInactiveAccounts(store, now);
  await purgeDeadSessions(store, now);
}

/** Ce qu'une passe de `runFullPurge` a effacé, pour le journal du run planifié. */
export interface FullPurgeReport {
  inactiveAccounts: number;
  deadSessions: number;
}

/**
 * TOUTES les purges de conservation en une passe, y compris celles qu'aucune route ne déclenche
 * quand le trafic se tarit : autorisations OAuth et appairages natifs expirés, compteurs anti-abus
 * dont la fenêtre est close.
 *
 * Raison d'être : chacune de ces purges est opportuniste — elle s'exécute à l'occasion d'un appel
 * qui touche déjà la table (Cloudflare Pages n'a pas de Cron Trigger, voir server/README.md). Sans
 * trafic d'authentification, rien ne tourne, et les durées annoncées par la politique de
 * confidentialité (§5) cessent d'être tenues : un compte inactif au-delà de 12 mois survit tant que
 * personne d'autre ne se connecte, et la dernière fenêtre de comptage anti-abus reste en base
 * indéfiniment (`docs/analyse-rgpd.md` 4.13). D'où l'appel planifié, hors requête
 * (`.github/workflows/rgpd-purges.yml` → `server/import/run-retention-purges.ts`), qui ne dépend
 * plus de la fréquentation du service.
 */
export async function runFullPurge(store: AuthStore, now: Date): Promise<FullPurgeReport> {
  const inactiveAccounts = await purgeInactiveAccounts(store, now);
  const deadSessions = await purgeDeadSessions(store, now);
  await store.purgeExpiredAuthorizations(now);
  await store.purgeExpiredPairings(now);
  await store.purgeRateLimits(new Date(now.getTime() - MAX_RATE_LIMIT_WINDOW_MS));
  return { inactiveAccounts, deadSessions };
}

export interface StartedAuthorization {
  state: string;
  codeChallenge: string;
}

/** Base factice servant à résoudre la cible de retour comme le ferait un navigateur. */
const REDIRECT_PROBE_ORIGIN = 'https://redirect-probe.invalid';
const MAX_REDIRECT_LENGTH = 2048;

/**
 * Normalise la cible de retour après connexion. **Seuls les chemins internes
 * sont acceptés** (`/quelque-chose`) : accepter une URL absolue ouvrirait une
 * redirection ouverte, qui transformerait notre domaine en tremplin de
 * hameçonnage.
 *
 * Audit du 2026-09-23 : un simple contrôle de préfixe (`/` sans `//`) ne
 * suffit pas — le parseur d'URL WHATWG traite `\` comme `/` et retire
 * tabulations et sauts de ligne, si bien que `/\evil.com`, `/\t/evil.com` ou
 * `/\n/evil.com` se résolvent tous vers `evil.com`. D'où, en plus du préfixe :
 * 1. rejet de toute barre oblique inverse et de tout caractère de contrôle
 *    (C0, DEL) ;
 * 2. résolution effective par `new URL` sur une origine factice, et contrôle
 *    que l'origine résolue est bien celle-là ;
 * 3. on renvoie la forme NORMALISÉE (chemin + requête + fragment), et on
 *    refuse qu'elle commence par `//` (cas `/.//evil.com`, que la
 *    normalisation des segments ramène à `//evil.com`).
 */
export function sanitizeRedirectTo(raw: string | null): string | null {
  if (!raw || raw.length > MAX_REDIRECT_LENGTH) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  let resolved: URL;
  try {
    resolved = new URL(raw, `${REDIRECT_PROBE_ORIGIN}/`);
  } catch {
    return null;
  }
  if (resolved.origin !== REDIRECT_PROBE_ORIGIN) return null;
  const normalized = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  if (!normalized.startsWith('/') || normalized.startsWith('//')) return null;
  return normalized;
}

/** Étape 1 : crée l'autorisation en attente (state + `code_verifier` PKCE). */
export async function startAuthorization(
  store: AuthStore,
  params: { provider: ProviderId; redirectTo: string | null; now: Date },
): Promise<StartedAuthorization> {
  const state = randomToken();
  const codeVerifier = randomToken(48);
  await store.createAuthorization({
    state,
    provider: params.provider,
    codeVerifier,
    redirectTo: sanitizeRedirectTo(params.redirectTo),
    expiresAt: new Date(params.now.getTime() + OAUTH_STATE_TTL_MS),
  });
  return { state, codeChallenge: await pkceChallenge(codeVerifier) };
}

export type CompleteError =
  | 'invalid_state' // state inconnu, expiré, DÉJÀ CONSOMMÉ (rejeu), ou ne correspondant pas au cookie
  | 'provider_mismatch'
  | 'exchange_failed'
  | 'email_taken'; // e-mail vérifié déjà porté par un compte ouvert avec un autre fournisseur

export interface CompletedAuthorization {
  /** Jeton de session à poser dans le cookie — jamais stocké tel quel en base. */
  token: string;
  csrfToken: string;
  expiresAt: Date;
  user: UserRecord;
  redirectTo: string | null;
  /** Vrai si un nouveau compte vient d'être créé (sert au parcours de migration des données locales, prompt 5.2). */
  isNewUser: boolean;
}

/**
 * Étape 2 : valide le `state`, échange le `code`, résout le compte, ouvre une
 * session.
 *
 * L'autorisation est consommée **avant** l'échange du code, et jamais
 * restaurée en cas d'échec : un `code` ne doit pouvoir être présenté qu'une
 * seule fois, y compris quand le premier essai a échoué en aval. L'utilisateur
 * relance simplement le flux depuis `/auth/{provider}/start`.
 */
export async function completeAuthorization(
  store: AuthStore,
  params: {
    provider: ProviderId;
    state: string;
    /** `state` lu dans le cookie posé au démarrage du flux (lien avec CE navigateur). */
    cookieState: string | null;
    fetchProfile: (codeVerifier: string) => Promise<OAuthProfile | null>;
    now: Date;
    userAgent: string | null;
    /** Session courante éventuelle, révoquée à la connexion (rotation). */
    currentSessionIdHash?: string | null;
  },
): Promise<
  | { ok: true; result: CompletedAuthorization }
  | {
      ok: false;
      error: CompleteError;
      /** Fournisseur du compte existant, seulement pour `email_taken` (message « connectez-vous avec… »). */
      existingProvider?: ProviderId;
    }
> {
  if (!params.state || !params.cookieState || !timingSafeEqual(params.state, params.cookieState)) {
    return { ok: false, error: 'invalid_state' };
  }

  const authorization = await store.consumeAuthorization(params.state, params.now);
  if (!authorization) return { ok: false, error: 'invalid_state' };
  if (authorization.provider !== params.provider) return { ok: false, error: 'provider_mismatch' };

  const profile = await params.fetchProfile(authorization.codeVerifier);
  if (!profile) return { ok: false, error: 'exchange_failed' };

  const resolution = await resolveAccount(store, params.provider, profile, params.now);
  if (!resolution.ok) {
    return { ok: false, error: 'email_taken', existingProvider: resolution.existingProvider };
  }
  const { user, isNewUser } = resolution;

  if (params.currentSessionIdHash) {
    await store.revokeSession(params.currentSessionIdHash, params.now);
  }
  const session = await openSession(store, user.id, {
    now: params.now,
    userAgent: params.userAgent,
  });

  // Purge opportuniste : Cloudflare Pages n'offre pas de Cron Trigger (voir
  // server/README.md), et ces lignes n'ont plus aucune valeur passé leur date.
  await store.purgeExpiredAuthorizations(params.now);
  await runRetentionPurges(store, params.now);

  return {
    ok: true,
    result: {
      token: session.token,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      user,
      redirectTo: authorization.redirectTo,
      isNewUser,
    },
  };
}

/**
 * Résolution du compte, dans cet ordre :
 * 1. identité `(provider, provider_uid)` déjà connue → ce compte ;
 * 2. sinon, e-mail **vérifié** déjà porté par un compte → **refus**
 *    (`email_taken`) : un compte n'utilise qu'UN fournisseur, Discord OU
 *    Google (décision du 2026-09-23, qui remplace la fusion automatique sur
 *    e-mail identique). L'utilisateur est invité à se reconnecter avec le
 *    fournisseur qui a ouvert le compte. Pas de création d'un second compte
 *    à la place : l'e-mail est unique en base (`users_email_key`), et deux
 *    comptes pour une même adresse seraient de toute façon un piège. Les
 *    comptes déjà liés aux deux fournisseurs avant cette décision restent
 *    tels quels (étape 1 : chaque identité connue retrouve son compte) ;
 * 3. sinon → nouveau compte.
 *
 * Un profil sans e-mail vérifié saute l'étape 2 : il ouvre toujours un
 * nouveau compte, sans e-mail (rien ne permet alors de reconnaître le compte
 * d'un autre fournisseur).
 */
async function resolveAccount(
  store: AuthStore,
  provider: ProviderId,
  profile: OAuthProfile,
  now: Date,
): Promise<
  | { ok: true; user: UserRecord; isNewUser: boolean }
  | { ok: false; existingProvider: ProviderId | undefined }
> {
  const email = profile.email ? profile.email.trim().toLowerCase() : null;

  const identity = await store.findIdentity(provider, profile.providerUid);
  if (identity) {
    const user = await store.findUserById(identity.userId);
    if (user) {
      await store.updateUser(user.id, {
        // On ne remplace un e-mail existant que s'il n'entre pas en conflit avec
        // un AUTRE compte (l'unicité est garantie en base) : un changement
        // d'adresse chez le fournisseur ne doit pas faire échouer la connexion.
        ...(email && email !== user.email && !(await isEmailTaken(store, email, user.id))
          ? { email }
          : {}),
        ...(profile.displayName && !user.displayName ? { displayName: profile.displayName } : {}),
        lastSeenAt: now,
      });
      return {
        ok: true,
        user: { ...user, email: email ?? user.email, displayName: user.displayName },
        isNewUser: false,
      };
    }
  }

  if (email) {
    const existing = await store.findUserByEmail(email);
    if (existing) {
      const identities = await store.listIdentities(existing.id);
      return { ok: false, existingProvider: identities[0]?.provider };
    }
  }

  const created = await store.createUser({ email, displayName: profile.displayName });
  await store.linkIdentity({
    userId: created.id,
    provider,
    providerUid: profile.providerUid,
    email,
    now,
  });
  await store.updateUser(created.id, { lastSeenAt: now });
  return { ok: true, user: created, isNewUser: true };
}

async function isEmailTaken(
  store: AuthStore,
  email: string,
  exceptUserId: string,
): Promise<boolean> {
  const owner = await store.findUserByEmail(email);
  return owner !== null && owner.id !== exceptUserId;
}

export interface OpenedSession {
  token: string;
  csrfToken: string;
  idHash: string;
  expiresAt: Date;
}

/**
 * Ouvre une session : jeton opaque de 256 bits côté cookie, empreinte
 * SHA-256 côté base.
 *
 * Le jeton CSRF (double-submit) est **dérivé** du jeton de session par
 * hachage plutôt que stocké : le cookie CSRF est lisible en JS par
 * construction, mais un hachage n'est pas inversible — il ne permet donc pas
 * de reconstituer le jeton de session, et il n'y a rien à persister ni à
 * faire expirer séparément.
 */
export async function openSession(
  store: AuthStore,
  userId: string,
  options: { now: Date; userAgent: string | null; ttlMs?: number },
): Promise<OpenedSession> {
  const token = randomToken();
  const idHash = await sha256Hex(token);
  const absoluteExpiresAt = new Date(options.now.getTime() + SESSION_MAX_LIFETIME_MS);
  const expiresAt = new Date(
    Math.min(
      options.now.getTime() + (options.ttlMs ?? SESSION_TTL_MS),
      absoluteExpiresAt.getTime(),
    ),
  );
  await store.createSession({
    idHash,
    userId,
    issuedAt: options.now,
    expiresAt,
    lastUsedAt: options.now,
    userAgent: options.userAgent,
    revokedAt: null,
    supersededAt: null,
    chainId: idHash,
    absoluteExpiresAt,
    graceRotatedAt: null,
  });
  return { token, csrfToken: await deriveCsrfToken(token), idHash, expiresAt };
}

export function deriveCsrfToken(sessionToken: string): Promise<string> {
  return sha256Hex(`${sessionToken}:csrf`);
}

export interface ResolvedSession {
  session: SessionRecord;
  user: UserRecord;
}

/**
 * Résout la session portée par un jeton de cookie. Renvoie `null` si le jeton
 * est inconnu, **révoqué** ou expiré — jamais une erreur : l'appelant retombe
 * simplement en mode invité (le mode invité doit rester pleinement
 * fonctionnel).
 *
 * Applique l'expiration glissante de 30 jours, mais seulement quand il reste
 * moins de 29 jours (voir SESSION_REFRESH_THRESHOLD_MS) — et jamais à une
 * session remplacée par rotation (`supersededAt`) : sa courte grâce doit
 * s'écouler, un usage pendant la grâce ne la ressuscite pas pour 30 jours.
 */
export async function resolveSession(
  store: AuthStore,
  token: string | null,
  now: Date,
): Promise<ResolvedSession | null> {
  if (!token) return null;
  const idHash = await sha256Hex(token);
  const session = await store.findSession(idHash);
  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt.getTime() <= now.getTime()) return null;
  const absoluteExpiry = sessionAbsoluteExpiry(session).getTime();
  if (absoluteExpiry <= now.getTime()) return null;

  const user = await store.findUserById(session.userId);
  if (!user) return null;

  // Prolongation plafonnée par la durée de vie absolue. Rafraîchie au plus une fois par jour :
  // soit parce qu'elle gagne au moins un jour, soit (session arrivée à son plafond) parce que la
  // dernière activité enregistrée date de plus d'un jour — l'activité du compte doit continuer à
  // être notée jusqu'au bout.
  const target = Math.min(now.getTime() + SESSION_TTL_MS, absoluteExpiry);
  const extendsByADay = target - session.expiresAt.getTime() > SESSION_REFRESH_THRESHOLD_MS;
  const staleActivity = now.getTime() - session.lastUsedAt.getTime() > SESSION_REFRESH_THRESHOLD_MS;
  if (session.supersededAt === null && (extendsByADay || staleActivity)) {
    const expiresAt = new Date(Math.max(target, session.expiresAt.getTime()));
    await store.touchSession(idHash, { lastUsedAt: now, expiresAt });
    // Même rythme pour l'activité du compte (purge d'inactivité) : une session
    // web ou overlay qui sert chaque jour tient le compte vivant sans
    // reconnexion.
    await store.updateUser(user.id, { lastSeenAt: now });
    // Au plus une fois par jour et par session : le bon rythme pour le ménage.
    await runRetentionPurges(store, now);
    return { session: { ...session, lastUsedAt: now, expiresAt }, user };
  }

  return { session, user };
}

/**
 * Vérifie le jeton CSRF double-submit d'une requête mutative. `SameSite=Lax`
 * couvre déjà l'essentiel ; ce contrôle est la seconde barrière posée sur les
 * routes sensibles (déconnexion, révocation, suppression de compte).
 */
export async function verifyCsrf(
  sessionToken: string,
  headerValue: string | null,
): Promise<boolean> {
  if (!headerValue) return false;
  return timingSafeEqual(await deriveCsrfToken(sessionToken), headerValue);
}
