/**
 * Source d'authentification d'une requête (audit de sécurité du 2026-09-23) : l'exemption CSRF
 * suit la source EFFECTIVE, et un en-tête `Authorization` présent n'autorise jamais de repli sur
 * le cookie.
 */

import { describe, expect, it } from 'vitest';
import { isCsrfExempt, isNativeCaller, readRequestCredential } from './request-auth';
import type { SessionRecord } from './store';

const TOKEN = 'A'.repeat(43);
const BEFORE_CUTOFF = new Date('2026-10-22T23:59:59Z');
const AFTER_CUTOFF = new Date('2026-10-23T00:00:00Z');

function request(headers: Record<string, string>): Request {
  return new Request('https://wakfu.example/api/v1/history/fights', { method: 'POST', headers });
}

function session(userAgent: string | null): SessionRecord {
  const now = new Date('2026-09-23T00:00:00Z');
  return {
    idHash: 'h',
    userId: 'u',
    issuedAt: now,
    expiresAt: now,
    lastUsedAt: now,
    userAgent,
    revokedAt: null,
    supersededAt: null,
    chainId: 'h',
    absoluteExpiresAt: null,
    graceRotatedAt: null,
  };
}

describe('readRequestCredential', () => {
  it('porteur valide → via bearer, même si un cookie de session est aussi présent', () => {
    expect(
      readRequestCredential(
        request({ authorization: `Bearer ${TOKEN}`, cookie: '__Host-wc_session=cookie' }),
      ),
    ).toEqual({ kind: 'token', token: TOKEN, via: 'bearer', legacyCookie: false });
  });

  it.each([
    'Bearer  ',
    `Bearer  ${TOKEN}`,
    'Bearer ',
    'Bearer',
    `Bearer  ${TOKEN}`,
    `Basic ${TOKEN}`,
    `Bearer ${TOKEN} extra`,
    '',
  ])('en-tête Authorization inutilisable %j → invalid, SANS repli sur le cookie', (header) => {
    const credential = readRequestCredential(
      request({ authorization: header, cookie: '__Host-wc_session=cookie' }),
    );
    expect(credential).toEqual({ kind: 'invalid' });
  });

  it('sans en-tête Authorization : cookie de session → via cookie', () => {
    expect(readRequestCredential(request({ cookie: '__Host-wc_session=abc' }))).toEqual({
      kind: 'token',
      token: 'abc',
      via: 'cookie',
      legacyCookie: false,
    });
    expect(readRequestCredential(request({ cookie: 'wc_session=abc' }), BEFORE_CUTOFF)).toEqual({
      kind: 'token',
      token: 'abc',
      via: 'cookie',
      legacyCookie: true,
    });
  });

  it('ancien cookie `wc_session` ignoré après la date butoir (horloge injectée)', () => {
    expect(readRequestCredential(request({ cookie: 'wc_session=abc' }), AFTER_CUTOFF)).toEqual({
      kind: 'none',
    });
    // Le nouveau nom, lui, reste lu après la butoir — usage légitime inchangé.
    expect(
      readRequestCredential(request({ cookie: '__Host-wc_session=abc' }), AFTER_CUTOFF),
    ).toMatchObject({ kind: 'token', token: 'abc', via: 'cookie', legacyCookie: false });
  });

  it('ni en-tête ni cookie → none', () => {
    expect(readRequestCredential(request({}))).toEqual({ kind: 'none' });
  });

  it('accepte le schéma sans tenir compte de la casse (RFC 6750)', () => {
    expect(readRequestCredential(request({ authorization: `bearer ${TOKEN}` }))).toMatchObject({
      kind: 'token',
      via: 'bearer',
    });
  });
});

describe('exemption CSRF et portée native', () => {
  it('seule une authentification par porteur est exemptée du CSRF', () => {
    expect(isCsrfExempt('bearer')).toBe(true);
    expect(isCsrfExempt('cookie')).toBe(false);
  });

  it('un jeton natif reste natif même présenté en cookie', () => {
    expect(isNativeCaller('bearer', session('Mozilla/5.0'))).toBe(true);
    expect(isNativeCaller('cookie', session('native-overlay'))).toBe(true);
    expect(isNativeCaller('cookie', session('Mozilla/5.0'))).toBe(false);
    expect(isNativeCaller('cookie', session(null))).toBe(false);
  });
});
