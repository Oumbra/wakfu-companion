/**
 * Clés de limitation de débit — audit de sécurité du 2026-09-23 : IPv6 comptée par /64, secret
 * obligatoire sur un déploiement public, `pollToken` jamais en clair dans une clé.
 */

import { describe, expect, it } from 'vitest';
import { MissingProductionSecretError, isPublicDeployment } from './environment';
import { clientIpKey, pollTokenBucket, rateLimitIpSubject, rateLimitSecret } from './rate-limit';

function from(ip: string, url = 'https://wakfu.example/api/v1/auth/native/pair'): Request {
  return new Request(url, { headers: { 'cf-connecting-ip': ip } });
}

describe('rateLimitIpSubject', () => {
  it('garde une IPv4 telle quelle', () => {
    expect(rateLimitIpSubject('203.0.113.7')).toBe('203.0.113.7');
  });

  it('tronque une IPv6 à son /64, quelle que soit sa notation', () => {
    const expected = '2001:db8:85a3:12::/64';
    expect(rateLimitIpSubject('2001:db8:85a3:12:1:2:3:4')).toBe(expected);
    expect(rateLimitIpSubject('2001:0DB8:85A3:0012:ffff:ffff:ffff:ffff')).toBe(expected);
    expect(rateLimitIpSubject('2001:db8:85a3:12::1')).toBe(expected);
    expect(rateLimitIpSubject('2001:db8:85a3:12::')).toBe(expected);
    expect(rateLimitIpSubject('[2001:db8:85a3:12::9]')).toBe(expected);
    expect(rateLimitIpSubject('2001:db8::')).toBe('2001:db8:0:0::/64');
  });

  it('ramène une IPv6 IPv4-mappée à son IPv4', () => {
    expect(rateLimitIpSubject('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitIpSubject('::ffff:cb00:7107')).toBe('203.0.113.7');
  });

  it('compte une valeur illisible telle quelle', () => {
    expect(rateLimitIpSubject('unknown')).toBe('unknown');
    expect(rateLimitIpSubject('1:2:3')).toBe('1:2:3');
  });
});

describe('clientIpKey', () => {
  const env = { RATE_LIMIT_SALT: 'sel' };

  it('donne la même clé à deux adresses du même /64, une autre au /64 voisin', async () => {
    const a = await clientIpKey(from('2001:db8:85a3:12::1'), env);
    expect(await clientIpKey(from('2001:db8:85a3:12:dead:beef:0:1'), env)).toBe(a);
    expect(await clientIpKey(from('2001:db8:85a3:13::1'), env)).not.toBe(a);
  });

  it('lève une erreur explicite sans RATE_LIMIT_SALT sur un déploiement public', async () => {
    await expect(
      clientIpKey(from('203.0.113.7'), { DATABASE_URL: 'postgres://x' }),
    ).rejects.toThrow(MissingProductionSecretError);
    await expect(
      clientIpKey(from('203.0.113.7', 'http://localhost:8788/api'), {
        DATABASE_URL: 'postgres://x',
        PUBLIC_BASE_URL: 'https://wakfu.example',
      }),
    ).rejects.toThrow(/RATE_LIMIT_SALT/);
  });
});

describe('rateLimitSecret / isPublicDeployment', () => {
  it('replie sur DATABASE_URL en développement local seulement', () => {
    expect(rateLimitSecret({ DATABASE_URL: 'postgres://x' }, 'http://localhost:8788/')).toBe(
      'postgres://x',
    );
    expect(rateLimitSecret({ DATABASE_URL: 'postgres://x' }, 'http://127.0.0.1:8788/')).toBe(
      'postgres://x',
    );
    expect(() =>
      rateLimitSecret({ DATABASE_URL: 'postgres://x' }, 'https://wakfu.example/'),
    ).toThrow(MissingProductionSecretError);
    expect(rateLimitSecret({ RATE_LIMIT_SALT: 's' }, 'https://wakfu.example/')).toBe('s');
  });

  it('reconnaît un déploiement public par PUBLIC_BASE_URL OU par l’URL servie', () => {
    expect(isPublicDeployment({}, 'http://localhost:8788/')).toBe(false);
    expect(isPublicDeployment({ PUBLIC_BASE_URL: 'http://localhost:4200' })).toBe(false);
    expect(isPublicDeployment({ PUBLIC_BASE_URL: 'https://localhost:4200' })).toBe(false);
    expect(isPublicDeployment({ PUBLIC_BASE_URL: 'https://wakfu.example' })).toBe(true);
    expect(isPublicDeployment({}, 'https://abc.wakfu-companion.pages.dev/api')).toBe(true);
    expect(isPublicDeployment({ PUBLIC_BASE_URL: 'pas une url' })).toBe(false);
  });
});

describe('pollTokenBucket', () => {
  it('ne contient jamais le pollToken en clair et reste stable', async () => {
    const token = 'x'.repeat(43);
    const bucket = await pollTokenBucket(token);
    expect(bucket).not.toContain(token);
    expect(bucket).toMatch(/^auth:native-poll:token:[0-9a-f]{32}$/);
    expect(await pollTokenBucket(token)).toBe(bucket);
    expect(await pollTokenBucket('y'.repeat(43))).not.toBe(bucket);
  });
});
