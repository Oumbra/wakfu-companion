/**
 * Cookies d'authentification — audit de sécurité du 2026-09-23 : préfixes `__Host-`/`__Secure-`
 * (avec transition depuis les anciens noms) et lecture robuste d'une valeur mal encodée.
 */

import { describe, expect, it } from 'vitest';
import {
  CSRF_COOKIE,
  LEGACY_CSRF_COOKIE,
  LEGACY_SESSION_COOKIE,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  clearedAuthCookies,
  clearedOauthStateCookies,
  csrfCookies,
  hasCsrfCookie,
  oauthStateCookie,
  readCookie,
  readOauthStateCookie,
  readSessionCookie,
  sessionCookie,
  sessionCookies,
} from './cookies';

function withCookie(cookie: string): Request {
  return new Request('https://wakfu.example/api/v1/auth/me', { headers: { cookie } });
}

/** Contraintes du préfixe `__Host-` (RFC 6265bis §4.1.3.2). */
function expectHostPrefixCompliant(setCookie: string): void {
  expect(setCookie.startsWith('__Host-')).toBe(true);
  expect(setCookie).toContain('; Secure');
  expect(setCookie).toContain('; Path=/;');
  expect(setCookie.toLowerCase()).not.toContain('domain=');
}

describe('readCookie', () => {
  it('rend null au lieu de lever sur une valeur mal encodée', () => {
    expect(readCookie(withCookie('a=%'), 'a')).toBeNull();
    expect(readCookie(withCookie('a=%E0%A4%A'), 'a')).toBeNull();
    expect(readCookie(withCookie('a=%zz; b=ok'), 'b')).toBe('ok');
  });

  it('décode une valeur correcte', () => {
    expect(readCookie(withCookie('x=1; a=h%C3%A9'), 'a')).toBe('hé');
  });
});

describe('noms préfixés et transition', () => {
  it('pose la session et le CSRF sous `__Host-`, conformes au préfixe', () => {
    expect(SESSION_COOKIE).toBe('__Host-wc_session');
    expect(CSRF_COOKIE).toBe('__Host-wc_csrf');
    expectHostPrefixCompliant(sessionCookie('jeton'));
    const [csrf] = csrfCookies('csrf');
    expectHostPrefixCompliant(csrf);
    expect(sessionCookie('jeton')).toContain('HttpOnly');
    expect(csrf).not.toContain('HttpOnly');
  });

  it('pose aussi l’ancien `wc_csrf` tant que le client le lit (même valeur)', () => {
    const cookies = csrfCookies('valeur');
    expect(cookies.some((c) => c.startsWith(`${LEGACY_CSRF_COOKIE}=valeur;`))).toBe(true);
  });

  it('connexion : nouveaux noms, ancien cookie de session effacé', () => {
    const cookies = sessionCookies('jeton', 'csrf');
    expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=jeton;`))).toBe(true);
    expect(cookies.some((c) => c.startsWith(`${CSRF_COOKIE}=csrf;`))).toBe(true);
    expect(cookies).toContain(
      cookies.find((c) => c.startsWith(`${LEGACY_SESSION_COOKIE}=;`) && c.includes('Max-Age=0')),
    );
  });

  it('lit le nouveau nom en priorité, retombe sur l’ancien en le signalant', () => {
    expect(readSessionCookie(withCookie('__Host-wc_session=neuf; wc_session=vieux'))).toEqual({
      token: 'neuf',
      legacy: false,
    });
    expect(readSessionCookie(withCookie('wc_session=vieux'))).toEqual({
      token: 'vieux',
      legacy: true,
    });
    expect(readSessionCookie(withCookie('autre=1'))).toBeNull();
  });

  it('déconnexion : efface les deux noms de session et de CSRF', () => {
    const cleared = clearedAuthCookies();
    for (const name of [SESSION_COOKIE, CSRF_COOKIE, LEGACY_SESSION_COOKIE, LEGACY_CSRF_COOKIE]) {
      expect(cleared.some((c) => c.startsWith(`${name}=;`) && c.includes('Max-Age=0'))).toBe(true);
    }
  });

  it('state OAuth : `__Secure-` restreint à /api/v1/auth, ancien nom lu en repli', () => {
    expect(OAUTH_STATE_COOKIE).toBe('__Secure-wc_oauth_state');
    const cookie = oauthStateCookie('etat');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain('; Secure');
    expect(readOauthStateCookie(withCookie('wc_oauth_state=ancien'))).toBe('ancien');
    expect(readOauthStateCookie(withCookie('__Secure-wc_oauth_state=neuf; wc_oauth_state=x'))).toBe(
      'neuf',
    );
    expect(clearedOauthStateCookies()).toHaveLength(2);
  });

  it('reconnaît un cookie CSRF sous l’un ou l’autre nom', () => {
    expect(hasCsrfCookie(withCookie('__Host-wc_csrf=a'))).toBe(true);
    expect(hasCsrfCookie(withCookie('wc_csrf=a'))).toBe(true);
    expect(hasCsrfCookie(withCookie('x=1'))).toBe(false);
  });
});
