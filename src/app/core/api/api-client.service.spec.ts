import { describe, expect, it } from 'vitest';
import { parseRetryAfterMs, readCsrfCookie } from './api-client.service';

describe('readCsrfCookie — transition vers le préfixe __Host-', () => {
  it('préfère `__Host-wc_csrf` quand les deux cookies coexistent', () => {
    expect(readCsrfCookie('wc_csrf=ancien; __Host-wc_csrf=nouveau')).toBe('nouveau');
  });

  it("retombe sur l'ancien nom `wc_csrf`", () => {
    expect(readCsrfCookie('autre=1; wc_csrf=abc%3D')).toBe('abc=');
  });

  it("ne confond pas un cookie dont le nom ne fait que contenir 'wc_csrf'", () => {
    expect(readCsrfCookie('x_wc_csrf=1; wc_csrf_old=2')).toBeNull();
  });
});

describe('parseRetryAfterMs', () => {
  it('lit un nombre de secondes', () => {
    expect(parseRetryAfterMs('30')).toBe(30_000);
  });

  it('lit une date HTTP', () => {
    const now = Date.parse('2026-09-23T10:00:00Z');
    expect(parseRetryAfterMs('Wed, 23 Sep 2026 10:01:00 GMT', now)).toBe(60_000);
  });

  it('ignore une valeur illisible et borne une valeur aberrante', () => {
    expect(parseRetryAfterMs('bientôt')).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs('999999999')).toBe(60 * 60_000);
  });
});
