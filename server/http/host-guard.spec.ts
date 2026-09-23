import { describe, expect, it } from 'vitest';
import {
  API_SECURITY_HEADERS,
  decideHost,
  rejectedHostResponse,
  withSecurityHeaders,
} from './host-guard';

describe('decideHost — politique par défaut (aucune variable)', () => {
  const env = {};

  it('autorise le domaine canonique, le domaine du projet et l’alias de preview', () => {
    expect(decideHost('wakfu-companion.com', env)).toBe('allow');
    expect(decideHost('www.wakfu-companion.com', env)).toBe('allow');
    expect(decideHost('wakfu-companion.pages.dev', env)).toBe('allow');
    expect(decideHost('claude-dev.wakfu-companion.pages.dev', env)).toBe('allow');
    expect(decideHost('Claude-Dev.Wakfu-Companion.pages.dev.', env)).toBe('allow');
  });

  it('refuse une URL de déploiement immuable <hash>.<projet>.pages.dev', () => {
    expect(decideHost('3f2a9c1b.wakfu-companion.pages.dev', env)).toBe('reject');
    expect(decideHost('deadbeef.wakfu-companion.pages.dev', env)).toBe('reject');
  });

  it('refuse l’alias d’une ancienne branche et tout sous-domaine plus profond', () => {
    expect(decideHost('claude-old-feature.wakfu-companion.pages.dev', env)).toBe('reject');
    expect(decideHost('a.b.wakfu-companion.pages.dev', env)).toBe('reject');
  });

  it('ne bloque jamais le développement local', () => {
    for (const host of ['localhost', 'app.localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1']) {
      expect(decideHost(host, env), host).toBe('allow');
    }
    // Test sur téléphone en réseau local (wrangler pages dev --ip 0.0.0.0).
    expect(decideHost('192.0.2.20', env)).toBe('allow');
  });

  it('autorise l’hôte de PUBLIC_BASE_URL même s’il est un sous-domaine pages.dev', () => {
    expect(
      decideHost('preview-x.wakfu-companion.pages.dev', {
        PUBLIC_BASE_URL: 'https://preview-x.wakfu-companion.pages.dev/',
      }),
    ).toBe('allow');
    // Une PUBLIC_BASE_URL illisible est ignorée, jamais une exception.
    expect(
      decideHost('3f2a9c1b.wakfu-companion.pages.dev', { PUBLIC_BASE_URL: 'pas une url' }),
    ).toBe('reject');
  });
});

describe('decideHost — ALLOWED_HOSTS (mode strict) et HOST_GUARD', () => {
  const strict = { ALLOWED_HOSTS: ' wakfu-companion.com , www.wakfu-companion.com ' };

  it('ne sert que les hôtes listés, plus la boucle locale', () => {
    expect(decideHost('wakfu-companion.com', strict)).toBe('allow');
    expect(decideHost('www.wakfu-companion.com', strict)).toBe('allow');
    expect(decideHost('wakfu-companion.pages.dev', strict)).toBe('reject');
    expect(decideHost('evil.example', strict)).toBe('reject');
    expect(decideHost('localhost', strict)).toBe('allow');
  });

  it('ajoute l’hôte de PUBLIC_BASE_URL à la liste stricte', () => {
    expect(
      decideHost('claude-dev.wakfu-companion.pages.dev', {
        ...strict,
        PUBLIC_BASE_URL: 'https://claude-dev.wakfu-companion.pages.dev',
      }),
    ).toBe('allow');
  });

  it('une liste vide retombe sur la politique par défaut', () => {
    expect(decideHost('wakfu-companion.com', { ALLOWED_HOSTS: ' , ' })).toBe('allow');
    expect(decideHost('3f2a9c1b.wakfu-companion.pages.dev', { ALLOWED_HOSTS: '' })).toBe('reject');
  });

  it('HOST_GUARD=off désactive tout contrôle', () => {
    expect(decideHost('3f2a9c1b.wakfu-companion.pages.dev', { HOST_GUARD: 'off' })).toBe('allow');
    expect(decideHost('evil.example', { ...strict, HOST_GUARD: ' OFF ' })).toBe('allow');
  });
});

describe('withSecurityHeaders', () => {
  it('pose les en-têtes manquants sans écraser ceux de la route', async () => {
    const original = new Response('{"ok":true}', {
      status: 201,
      headers: { 'content-type': 'application/json', 'x-frame-options': 'SAMEORIGIN' },
    });
    const response = withSecurityHeaders(original);
    expect(response.status).toBe(201);
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('strict-transport-security')).toBe(
      'max-age=63072000; includeSubDomains',
    );
    expect(await response.text()).toBe('{"ok":true}');
  });

  it('fonctionne sur une réponse aux en-têtes immuables (redirection OAuth)', () => {
    const redirect = Response.redirect('https://discord.com/oauth2/authorize', 302);
    const response = withSecurityHeaders(redirect);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://discord.com/oauth2/authorize');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('conserve plusieurs Set-Cookie', () => {
    const headers = new Headers();
    headers.append('set-cookie', 'a=1; Path=/');
    headers.append('set-cookie', 'b=2; Path=/');
    const response = withSecurityHeaders(new Response(null, { status: 204, headers }));
    expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  });

  it('la réponse de refus d’hôte est un 404 neutre, sécurisée et non mise en cache', async () => {
    const response = rejectedHostResponse();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    for (const name of Object.keys(API_SECURITY_HEADERS)) {
      expect(response.headers.has(name), name).toBe(true);
    }
    expect(await response.text()).toBe('Not Found');
  });
});
