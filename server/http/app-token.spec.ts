import { describe, expect, it } from 'vitest';
import {
  APP_TOKEN_COOKIE,
  APP_TOKEN_TTL_MS,
  appTokenCookie,
  appTokenSecret,
  signAppToken,
  verifyAppToken,
} from './app-token';

const SECRET = 'un-secret-de-test-suffisamment-long';
const NOW = 1_800_000_000_000;

describe('jeton d’application du site', () => {
  it('signe puis vérifie un jeton frais', async () => {
    const token = await signAppToken(SECRET, NOW);
    expect(token).toMatch(/^\d+\.[A-Za-z0-9_-]+$/);
    expect(await verifyAppToken(SECRET, token, NOW + 1000)).toBe(true);
  });

  it('refuse un jeton expiré, daté du futur, ou signé avec un autre secret', async () => {
    const token = await signAppToken(SECRET, NOW);
    expect(await verifyAppToken(SECRET, token, NOW + APP_TOKEN_TTL_MS + 1)).toBe(false);
    expect(await verifyAppToken(SECRET, token, NOW - 5 * 60 * 1000)).toBe(false);
    expect(await verifyAppToken('autre-secret', token, NOW)).toBe(false);
  });

  it('refuse un jeton altéré, mal formé, vide ou absent', async () => {
    const token = await signAppToken(SECRET, NOW);
    const [issuedAt, signature] = token.split('.');
    expect(await verifyAppToken(SECRET, `${issuedAt}.${signature.slice(0, -1)}x`, NOW)).toBe(false);
    expect(await verifyAppToken(SECRET, `${Number(issuedAt) + 1}.${signature}`, NOW)).toBe(false);
    expect(await verifyAppToken(SECRET, 'pas-de-point', NOW)).toBe(false);
    expect(await verifyAppToken(SECRET, `${issuedAt}.`, NOW)).toBe(false);
    expect(await verifyAppToken(SECRET, `abc.${signature}`, NOW)).toBe(false);
    expect(await verifyAppToken(SECRET, '', NOW)).toBe(false);
    expect(await verifyAppToken(SECRET, null, NOW)).toBe(false);
  });

  it('ne signe ni ne vérifie jamais avec un secret vide', async () => {
    await expect(signAppToken('', NOW)).rejects.toThrow();
    const token = await signAppToken(SECRET, NOW);
    expect(await verifyAppToken('', token, NOW)).toBe(false);
  });

  it('retombe sur DATABASE_URL comme matière à clé, jamais sur une chaîne vide', () => {
    expect(appTokenSecret({ APP_TOKEN_SECRET: 'dédié', DATABASE_URL: 'postgres://x' })).toBe(
      'dédié',
    );
    expect(appTokenSecret({ DATABASE_URL: 'postgres://x' })).toBe('postgres://x');
    expect(appTokenSecret({})).toBe('');
  });

  it('pose un cookie HttpOnly, Secure, SameSite=Strict, limité à /api/v1', () => {
    const cookie = appTokenCookie('123.abc');
    expect(cookie.startsWith(`${APP_TOKEN_COOKIE}=123.abc; `)).toBe(true);
    expect(cookie).toContain('Path=/api/v1');
    expect(cookie).toContain(`Max-Age=${APP_TOKEN_TTL_MS / 1000}`);
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
  });
});
