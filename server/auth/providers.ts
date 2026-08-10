/**
 * Fournisseurs OAuth 2.0 supportés (lot 5, prompt 5.1) : Discord et Google,
 * et rien d'autre — aucun mot de passe n'est géré en propre (§7 du plan).
 *
 * Tout l'échange de code se fait **côté serveur** : le `client_secret` ne
 * transite jamais par le navigateur. Le flux utilise `state` (anti-CSRF) et
 * PKCE S256, les deux fournisseurs le supportant.
 */

import type { ProviderId } from './store';

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

interface ProviderDefinition {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
  /** Normalise la réponse `userinfo` propre au fournisseur. */
  parseProfile: (raw: unknown) => OAuthProfile | null;
}

/** Profil normalisé, indépendant du fournisseur. */
export interface OAuthProfile {
  providerUid: string;
  /**
   * E-mail **vérifié** par le fournisseur, ou `null`. Un e-mail non vérifié
   * est volontairement traité comme absent : c'est lui qui déclenche la
   * fusion de comptes (§7), une adresse non vérifiée permettrait de
   * s'approprier le compte d'un tiers.
   */
  email: string | null;
  displayName: string | null;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
}

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  discord: {
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    scope: 'identify email',
    parseProfile: (raw) => {
      const user = asRecord(raw);
      if (!user || typeof user['id'] !== 'string') return null;
      const verified = user['verified'] === true;
      const email = verified && typeof user['email'] === 'string' ? user['email'] : null;
      const displayName =
        (typeof user['global_name'] === 'string' ? user['global_name'] : null) ??
        (typeof user['username'] === 'string' ? user['username'] : null);
      return { providerUid: user['id'], email, displayName };
    },
  },
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    parseProfile: (raw) => {
      const user = asRecord(raw);
      if (!user || typeof user['sub'] !== 'string') return null;
      // `email_verified` peut arriver en booléen ou en chaîne "true" selon l'endpoint OIDC.
      const verified = user['email_verified'] === true || user['email_verified'] === 'true';
      const email = verified && typeof user['email'] === 'string' ? user['email'] : null;
      const displayName = typeof user['name'] === 'string' ? user['name'] : null;
      return { providerUid: user['sub'], email, displayName };
    },
  },
};

export function isProviderId(value: string): value is ProviderId {
  return value === 'discord' || value === 'google';
}

/** URL de redirection du fournisseur — doit être IDENTIQUE au `start` et au `callback`. */
export function redirectUri(baseUrl: string, provider: ProviderId): string {
  return `${baseUrl.replace(/\/$/, '')}/api/v1/auth/${provider}/callback`;
}

/** URL d'autorisation vers laquelle rediriger le navigateur (étape `start`). */
export function buildAuthorizeUrl(params: {
  provider: ProviderId;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const definition = PROVIDERS[params.provider];
  const url = new URL(definition.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', definition.scope);
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (params.provider === 'google') {
    // Sans ça, Google ne redemande pas le consentement et peut omettre l'e-mail
    // sur un compte déjà autorisé avec des scopes plus étroits.
    url.searchParams.set('include_granted_scopes', 'true');
  }
  return url.toString();
}

export type ProfileFetcher = (codeVerifier: string) => Promise<OAuthProfile | null>;

/**
 * Échange le `code` contre un jeton d'accès puis lit le profil — côté serveur
 * uniquement. Renvoie `null` sur tout échec (code invalide/expiré, réponse
 * inattendue) : l'appelant traduit ça en erreur générique, sans jamais
 * renvoyer au navigateur le détail de la réponse du fournisseur.
 */
export async function fetchOAuthProfile(params: {
  provider: ProviderId;
  credentials: ProviderCredentials;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<OAuthProfile | null> {
  const definition = PROVIDERS[params.provider];
  const doFetch = params.fetchImpl ?? fetch;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.credentials.clientId,
    client_secret: params.credentials.clientSecret,
    code_verifier: params.codeVerifier,
  });

  const tokenResponse = await doFetch(definition.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });
  if (!tokenResponse.ok) return null;

  const tokenPayload = asRecord(await tokenResponse.json().catch(() => null));
  const accessToken = tokenPayload?.['access_token'];
  if (typeof accessToken !== 'string') return null;

  const userResponse = await doFetch(definition.userInfoUrl, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (!userResponse.ok) return null;

  return definition.parseProfile(await userResponse.json().catch(() => null));
}
