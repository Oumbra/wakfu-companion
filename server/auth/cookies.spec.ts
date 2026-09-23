/**
 * Cookies d'authentification — audit de sécurité du 2026-09-23 : préfixes `__Host-`/`__Secure-`
 * (avec transition depuis les anciens noms) et lecture robuste d'une valeur mal encodée.
 */

import { describe, expect, it } from 'vitest';
import {
  CSRF_COOKIE,
  LEGACY_CSRF_COOKIE,
  LEGACY_SESSION_COOKIE,
  LEGACY_SESSION_COOKIE_UNTIL,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  clearedAuthCookies,
  clearedOauthStateCookies,
  csrfCookies,
  emitLegacyCsrfCookie,
  hasCsrfCookie,
  oauthStateCookie,
  readCookie,
  readOauthStateCookie,
  readSessionCookie,
  sessionCookie,
  sessionCookies,
} from './cookies';

const BEFORE_CUTOFF = new Date('2026-10-22T23:59:59Z');
const AFTER_CUTOFF = new Date('2026-10-23T00:00:00Z');

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

  it('pose aussi l’ancien `wc_csrf` jusqu’à la date butoir, plus après (horloge injectée)', () => {
    const before = csrfCookies('valeur', undefined, BEFORE_CUTOFF);
    expect(before.some((c) => c.startsWith(`${LEGACY_CSRF_COOKIE}=valeur;`))).toBe(true);
    const after = csrfCookies('valeur', undefined, AFTER_CUTOFF);
    expect(after).toHaveLength(1);
    expect(after[0].startsWith(`${CSRF_COOKIE}=valeur;`)).toBe(true);
    expect(emitLegacyCsrfCookie(BEFORE_CUTOFF)).toBe(true);
    expect(emitLegacyCsrfCookie(AFTER_CUTOFF)).toBe(false);
    expect(LEGACY_SESSION_COOKIE_UNTIL.toISOString()).toBe('2026-10-23T00:00:00.000Z');
  });

  it('connexion : nouveaux noms, ancien cookie de session effacé', () => {
    const cookies = sessionCookies('jeton', 'csrf');
    expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=jeton;`))).toBe(true);
    expect(cookies.some((c) => c.startsWith(`${CSRF_COOKIE}=csrf;`))).toBe(true);
    expect(cookies).toContain(
      cookies.find((c) => c.startsWith(`${LEGACY_SESSION_COOKIE}=;`) && c.includes('Max-Age=0')),
    );
  });

  it('lit le nouveau nom en priorité, retombe sur l’ancien en le signalant (avant la butoir)', () => {
    expect(
      readSessionCookie(withCookie('__Host-wc_session=neuf; wc_session=vieux'), BEFORE_CUTOFF),
    ).toEqual({ token: 'neuf', legacy: false });
    expect(readSessionCookie(withCookie('wc_session=vieux'), BEFORE_CUTOFF)).toEqual({
      token: 'vieux',
      legacy: true,
    });
    expect(readSessionCookie(withCookie('autre=1'), BEFORE_CUTOFF)).toBeNull();
  });

  it('après la butoir : ancien `wc_session` ignoré, nouveau nom toujours lu', () => {
    expect(readSessionCookie(withCookie('wc_session=vieux'), AFTER_CUTOFF)).toBeNull();
    expect(
      readSessionCookie(withCookie('__Host-wc_session=neuf; wc_session=vieux'), AFTER_CUTOFF),
    ).toEqual({ token: 'neuf', legacy: false });
    expect(hasCsrfCookie(withCookie('wc_csrf=a'), AFTER_CUTOFF)).toBe(false);
    expect(hasCsrfCookie(withCookie('__Host-wc_csrf=a'), AFTER_CUTOFF)).toBe(true);
  });

  it('déconnexion : efface les deux noms de session et de CSRF', () => {
    const cleared = clearedAuthCookies();
    for (const name of [SESSION_COOKIE, CSRF_COOKIE, LEGACY_SESSION_COOKIE, LEGACY_CSRF_COOKIE]) {
      expect(cleared.some((c) => c.startsWith(`${name}=;`) && c.includes('Max-Age=0'))).toBe(true);
    }
  });

  it('state OAuth : `__Host-`, Path=/, conforme au préfixe ; aucun ancien nom lu', () => {
    expect(OAUTH_STATE_COOKIE).toBe('__Host-wc_oauth_state');
    const cookie = oauthStateCookie('etat');
    expectHostPrefixCompliant(cookie);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Max-Age=600');
    // Flux légitime : le state posé par /start est relu tel quel par /callback.
    expect(readOauthStateCookie(withCookie(cookie.split(';')[0]))).toBe('etat');
    // Anciens noms : plus jamais lus (un state vit 10 min), et ne gênent pas le nouveau.
    expect(readOauthStateCookie(withCookie('wc_oauth_state=ancien'))).toBeNull();
    expect(readOauthStateCookie(withCookie('__Secure-wc_oauth_state=ancien'))).toBeNull();
    expect(
      readOauthStateCookie(
        withCookie('__Secure-wc_oauth_state=ancien; __Host-wc_oauth_state=neuf; wc_oauth_state=x'),
      ),
    ).toBe('neuf');
  });

  it('retour OAuth : efface le state courant (Path=/) et les anciens sous leur chemin d’origine', () => {
    const cleared = clearedOauthStateCookies();
    expect(cleared).toHaveLength(3);
    const current = cleared.find((c) => c.startsWith('__Host-wc_oauth_state=;'));
    expect(current).toBeDefined();
    expectHostPrefixCompliant(current!);
    expect(current).toContain('Max-Age=0');
    for (const name of ['__Secure-wc_oauth_state', 'wc_oauth_state']) {
      const stale = cleared.find((c) => c.startsWith(`${name}=;`));
      expect(stale).toContain('Path=/api/v1/auth');
      expect(stale).toContain('Max-Age=0');
    }
  });

  it('reconnaît un cookie CSRF sous l’un ou l’autre nom avant la butoir', () => {
    expect(hasCsrfCookie(withCookie('__Host-wc_csrf=a'), BEFORE_CUTOFF)).toBe(true);
    expect(hasCsrfCookie(withCookie('wc_csrf=a'), BEFORE_CUTOFF)).toBe(true);
    expect(hasCsrfCookie(withCookie('x=1'), BEFORE_CUTOFF)).toBe(false);
  });
});
