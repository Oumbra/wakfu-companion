/**
 * Cœur du flux d'authentification (lot 5, prompt 5.1) — indépendant de
 * Cloudflare, de Postgres et du réseau : tout passe par le port `AuthStore`
 * (server/auth/store.ts) et par un `ProfileFetcher` injecté. C'est ce qui
 * rend testables sans infrastructure les quatre exigences du prompt : `state`
 * invalide rejeté, code réutilisé rejeté, session révoquée refusée, fusion
 * sur e-mail identique.
 *
 * Voir docs/plan-migration-serveur.md §7 pour les décisions structurantes
 * (OAuth uniquement, cookie opaque, sessions en base, mode invité intact).
 */

import { pkceChallenge, randomToken, sha256Hex, timingSafeEqual } from './crypto';
import { OAUTH_STATE_TTL_MS, SESSION_TTL_MS } from './cookies';
import type { OAuthProfile } from './providers';
import type { AuthStore, ProviderId, SessionRecord, UserRecord } from './store';

/**
 * Au-delà de ce délai restant, on ne réécrit pas la ligne de session : sans
 * ce seuil, l'expiration glissante ferait un `UPDATE` à chaque requête
 * authentifiée pour un gain nul.
 */
const SESSION_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface StartedAuthorization {
  state: string;
  codeChallenge: string;
}

/**
 * Normalise la cible de retour après connexion. **Seuls les chemins internes
 * sont acceptés** (`/quelque-chose`) : accepter une URL absolue ouvrirait une
 * redirection ouverte, qui transformerait notre domaine en tremplin de
 * hameçonnage. `//evil.com` est rejeté aussi (URL protocole-relative).
 */
export function sanitizeRedirectTo(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
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
  | 'exchange_failed';

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
    /** Session courante éventuelle, révoquée à la connexion (rotation, §7). */
    currentSessionIdHash?: string | null;
  },
): Promise<{ ok: true; result: CompletedAuthorization } | { ok: false; error: CompleteError }> {
  if (!params.state || !params.cookieState || !timingSafeEqual(params.state, params.cookieState)) {
    return { ok: false, error: 'invalid_state' };
  }

  const authorization = await store.consumeAuthorization(params.state, params.now);
  if (!authorization) return { ok: false, error: 'invalid_state' };
  if (authorization.provider !== params.provider) return { ok: false, error: 'provider_mismatch' };

  const profile = await params.fetchProfile(authorization.codeVerifier);
  if (!profile) return { ok: false, error: 'exchange_failed' };

  const { user, isNewUser } = await resolveAccount(store, params.provider, profile, params.now);

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
 * 2. sinon, e-mail **vérifié** déjà porté par un compte → l'identité est
 *    rattachée à ce compte (**fusion**, §7 du plan : Discord et Google
 *    vérifient tous deux l'adresse, ce qui rend le rattachement automatique
 *    sûr et évite un écran de liaison manuelle) ;
 * 3. sinon → nouveau compte.
 *
 * Un profil sans e-mail vérifié ne participe jamais à la fusion (étape 2
 * sautée) : une adresse non vérifiée permettrait de s'approprier le compte
 * d'un tiers.
 */
async function resolveAccount(
  store: AuthStore,
  provider: ProviderId,
  profile: OAuthProfile,
  now: Date,
): Promise<{ user: UserRecord; isNewUser: boolean }> {
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
        user: { ...user, email: email ?? user.email, displayName: user.displayName },
        isNewUser: false,
      };
    }
  }

  if (email) {
    const existing = await store.findUserByEmail(email);
    if (existing) {
      await store.linkIdentity({
        userId: existing.id,
        provider,
        providerUid: profile.providerUid,
        email,
        now,
      });
      await store.updateUser(existing.id, { lastSeenAt: now });
      return { user: existing, isNewUser: false };
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
  return { user: created, isNewUser: true };
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
  const expiresAt = new Date(options.now.getTime() + (options.ttlMs ?? SESSION_TTL_MS));
  await store.createSession({
    idHash,
    userId,
    issuedAt: options.now,
    expiresAt,
    lastUsedAt: options.now,
    userAgent: options.userAgent,
    revokedAt: null,
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
 * fonctionnel, §7).
 *
 * Applique l'expiration glissante de 30 jours, mais seulement quand il reste
 * moins de 29 jours (voir SESSION_REFRESH_THRESHOLD_MS).
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

  const user = await store.findUserById(session.userId);
  if (!user) return null;

  const remaining = session.expiresAt.getTime() - now.getTime();
  if (remaining < SESSION_TTL_MS - SESSION_REFRESH_THRESHOLD_MS) {
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await store.touchSession(idHash, { lastUsedAt: now, expiresAt });
    return { session: { ...session, lastUsedAt: now, expiresAt }, user };
  }

  return { session, user };
}

/**
 * Vérifie le jeton CSRF double-submit d'une requête mutative. `SameSite=Lax`
 * couvre déjà l'essentiel ; ce contrôle est la seconde barrière exigée par le
 * §7 du plan sur les routes sensibles (déconnexion, révocation, suppression
 * de compte).
 */
export async function verifyCsrf(
  sessionToken: string,
  headerValue: string | null,
): Promise<boolean> {
  if (!headerValue) return false;
  return timingSafeEqual(await deriveCsrfToken(sessionToken), headerValue);
}
