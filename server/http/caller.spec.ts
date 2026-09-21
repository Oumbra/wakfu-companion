import { describe, expect, it } from 'vitest';
import { isSameOriginRequest } from './caller';

const headersOf = (entries: Record<string, string>) => ({
  get: (name: string) => entries[name.toLowerCase()] ?? null,
});

describe('reconnaissance de l’appelant des routes référentiel', () => {
  it('reconnaît le site par Sec-Fetch-Site: same-origin, quelle que soit la casse', () => {
    expect(isSameOriginRequest(headersOf({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(isSameOriginRequest(headersOf({ 'sec-fetch-site': ' Same-Origin ' }))).toBe(true);
  });

  it('refuse une page tierce, un curl anonyme, et n’accepte ni Referer ni User-Agent', () => {
    expect(
      isSameOriginRequest(
        headersOf({
          'sec-fetch-site': 'cross-site',
          referer: 'https://autre-site.example/',
          'user-agent': 'Mozilla/5.0',
        }),
      ),
    ).toBe(false);
    expect(isSameOriginRequest(headersOf({ 'sec-fetch-site': 'same-site' }))).toBe(false);
    expect(isSameOriginRequest(headersOf({ 'sec-fetch-site': 'none' }))).toBe(false);
    expect(isSameOriginRequest(headersOf({ 'user-agent': 'curl/8.0' }))).toBe(false);
    expect(isSameOriginRequest(headersOf({ referer: 'https://wakfu-companion.com/' }))).toBe(false);
    expect(isSameOriginRequest(headersOf({ 'user-agent': 'ureq/3.1.0' }))).toBe(false);
    expect(isSameOriginRequest(headersOf({}))).toBe(false);
  });
});
