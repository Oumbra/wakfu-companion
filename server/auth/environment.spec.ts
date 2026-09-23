/**
 * Détection « déploiement public » (audit de sécurité du 2026-09-23, #10) : tout hôte hors de la
 * boucle locale est public, quel que soit le schéma.
 */

import { describe, expect, it } from 'vitest';
import { isLoopbackHostname, isPublicDeployment } from './environment';

describe('isPublicDeployment — hôte hors boucle locale, quel que soit le schéma', () => {
  it('développement local : jamais public (non-régression wrangler + proxy Angular)', () => {
    for (const url of [
      'http://localhost:8788/api/v1/auth/me',
      'http://localhost:4200/',
      'https://localhost:4200/',
      'http://app.localhost:8788/',
      'http://127.0.0.1:8788/',
      'http://127.12.0.3/',
      'http://[::1]:8788/',
    ]) {
      expect(isPublicDeployment({}, url)).toBe(false);
      expect(isPublicDeployment({ PUBLIC_BASE_URL: url })).toBe(false);
    }
  });

  it('déploiement réel en https : public (inchangé)', () => {
    expect(isPublicDeployment({ PUBLIC_BASE_URL: 'https://wakfu-companion.com' })).toBe(true);
    expect(isPublicDeployment({}, 'https://wakfu-companion.pages.dev/api/v1/auth/me')).toBe(true);
    expect(isPublicDeployment({}, 'https://claude-dev.wakfu-companion.pages.dev/api')).toBe(true);
  });

  it('hôte public servi ou déclaré en http : désormais public (repli de dev refusé)', () => {
    expect(isPublicDeployment({}, 'http://wakfu-companion.com/api/v1/app/token')).toBe(true);
    expect(isPublicDeployment({ PUBLIC_BASE_URL: 'http://wakfu-companion.com' })).toBe(true);
    expect(isPublicDeployment({}, 'http://192.0.2.20:8788/api')).toBe(true);
    expect(isPublicDeployment({}, 'http://128.0.0.1/')).toBe(true);
  });

  it('valeur absente ou illisible : pas un signal public', () => {
    expect(isPublicDeployment({})).toBe(false);
    expect(isPublicDeployment({ PUBLIC_BASE_URL: '' }, null)).toBe(false);
    expect(isPublicDeployment({ PUBLIC_BASE_URL: 'pas une url' })).toBe(false);
  });

  it('un seul des deux signaux suffit', () => {
    expect(
      isPublicDeployment({ PUBLIC_BASE_URL: 'https://wakfu-companion.com' }, 'http://localhost/'),
    ).toBe(true);
    expect(isPublicDeployment({ PUBLIC_BASE_URL: 'http://localhost:4200' }, 'http://x.dev/')).toBe(
      true,
    );
  });
});

describe('isLoopbackHostname', () => {
  it('reconnaît localhost, *.localhost, 127.0.0.0/8 et ::1, sans tenir compte de la casse', () => {
    for (const host of [
      'localhost',
      'LOCALHOST',
      'a.localhost',
      '127.0.0.1',
      '127.255.1.9',
      '::1',
      '[::1]',
    ]) {
      expect(isLoopbackHostname(host)).toBe(true);
    }
    for (const host of [
      'localhost.example.com',
      '192.0.2.1',
      '1127.0.0.1',
      'wakfu-companion.com',
    ]) {
      expect(isLoopbackHostname(host)).toBe(false);
    }
  });
});
