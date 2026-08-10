/**
 * Tests des adaptateurs de fournisseurs OAuth (lot 5, prompt 5.1) : le point
 * sensible est la normalisation du profil — un e-mail NON vérifié doit
 * ressortir à `null`, sans quoi il déclencherait une fusion de comptes (§7 du
 * plan) sur une adresse que le fournisseur n'a pas validée.
 *
 * `fetch` est simulé : aucun appel réseau réel.
 */

import { describe, expect, it } from 'vitest';
import { buildAuthorizeUrl, fetchOAuthProfile, isProviderId, redirectUri } from './providers';
import type { ProviderId } from './store';

function fakeFetch(responses: { token?: unknown; user?: unknown; tokenStatus?: number }) {
  const calls: { url: string; body?: string }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.includes('token')) {
      return new Response(JSON.stringify(responses.token ?? {}), {
        status: responses.tokenStatus ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(responses.user ?? {}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

async function profileFor(provider: ProviderId, user: unknown, tokenStatus = 200) {
  const { impl, calls } = fakeFetch({
    token: { access_token: 'jeton-acces' },
    user,
    tokenStatus,
  });
  const profile = await fetchOAuthProfile({
    provider,
    credentials: { clientId: 'id', clientSecret: 'secret' },
    code: 'code-123',
    codeVerifier: 'verifier-123',
    redirectUri: 'https://exemple.test/api/v1/auth/discord/callback',
    fetchImpl: impl,
  });
  return { profile, calls };
}

describe('fetchOAuthProfile — Discord', () => {
  it('normalise un profil avec e-mail vérifié', async () => {
    const { profile, calls } = await profileFor('discord', {
      id: '42',
      username: 'joueur',
      global_name: 'Joueur',
      email: 'joueur@example.com',
      verified: true,
    });
    expect(profile).toEqual({
      providerUid: '42',
      email: 'joueur@example.com',
      displayName: 'Joueur',
    });
    // Le secret et le code_verifier partent bien côté serveur, dans le corps POST.
    expect(calls[0]?.body).toContain('client_secret=secret');
    expect(calls[0]?.body).toContain('code_verifier=verifier-123');
  });

  it('ignore un e-mail non vérifié', async () => {
    const { profile } = await profileFor('discord', {
      id: '42',
      username: 'joueur',
      email: 'joueur@example.com',
      verified: false,
    });
    expect(profile?.email).toBeNull();
  });
});

describe('fetchOAuthProfile — Google', () => {
  it('accepte email_verified booléen ou chaîne', async () => {
    const asBool = await profileFor('google', {
      sub: 'g-1',
      name: 'Joueur',
      email: 'joueur@example.com',
      email_verified: true,
    });
    const asString = await profileFor('google', {
      sub: 'g-1',
      name: 'Joueur',
      email: 'joueur@example.com',
      email_verified: 'true',
    });
    expect(asBool.profile?.email).toBe('joueur@example.com');
    expect(asString.profile?.email).toBe('joueur@example.com');
  });

  it('renvoie null si l’échange de code échoue', async () => {
    const { profile } = await profileFor('google', { sub: 'g-1' }, 400);
    expect(profile).toBeNull();
  });
});

describe('URLs OAuth', () => {
  it('construit une URL d’autorisation avec state et PKCE S256', () => {
    const url = new URL(
      buildAuthorizeUrl({
        provider: 'discord',
        clientId: 'client-1',
        redirectUri: 'https://exemple.test/api/v1/auth/discord/callback',
        state: 'state-1',
        codeChallenge: 'challenge-1',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('email');
    // Le secret ne doit JAMAIS partir dans l'URL vue par le navigateur.
    expect(url.search).not.toContain('secret');
  });

  it('construit la même URL de redirection des deux côtés du flux', () => {
    expect(redirectUri('https://exemple.test/', 'google')).toBe(
      'https://exemple.test/api/v1/auth/google/callback',
    );
  });

  it('ne reconnaît que les deux fournisseurs supportés', () => {
    expect(isProviderId('discord')).toBe(true);
    expect(isProviderId('google')).toBe(true);
    expect(isProviderId('facebook')).toBe(false);
  });
});
