import { describe, expect, it } from 'vitest';
import { identifyCaller } from './caller';

const headersOf = (entries: Record<string, string>) => ({
  get: (name: string) => entries[name.toLowerCase()] ?? null,
});
const SITE_URL = 'https://wakfu-companion.com/api/v1/icons/items/1234.png';

describe('reconnaissance de l’appelant des routes référentiel', () => {
  it('reconnaît le site par Sec-Fetch-Site, sinon par le Referer ou l’Origin du même hôte', () => {
    expect(identifyCaller(headersOf({ 'sec-fetch-site': 'same-origin' }), SITE_URL)).toBe('site');
    expect(
      identifyCaller(headersOf({ referer: 'https://wakfu-companion.com/fr/profil' }), SITE_URL),
    ).toBe('site');
    expect(identifyCaller(headersOf({ origin: 'https://wakfu-companion.com' }), SITE_URL)).toBe(
      'site',
    );
    // ng serve : hôte et Referer restent localhost:4200 (proxy sans changeOrigin).
    expect(
      identifyCaller(
        headersOf({ referer: 'http://localhost:4200/' }),
        'http://localhost:4200/api/v1/icons/items/1.png',
      ),
    ).toBe('site');
    // Preview Cloudflare Pages : même origine que sa propre page.
    expect(
      identifyCaller(
        headersOf({
          'sec-fetch-site': 'same-origin',
          referer: 'https://claude-dev.wakfu-companion.pages.dev/',
        }),
        'https://claude-dev.wakfu-companion.pages.dev/api/v1/icons/items/1.png',
      ),
    ).toBe('site');
  });

  it('reconnaît l’overlay à son User-Agent', () => {
    expect(identifyCaller(headersOf({ 'user-agent': 'ureq/3.1.0' }), SITE_URL)).toBe('overlay');
    expect(
      identifyCaller(headersOf({ 'user-agent': 'wakfu-companion-overlay/1.4.0' }), SITE_URL),
    ).toBe('overlay');
  });

  it('refuse une page tierce, un curl anonyme et un Referer d’un autre hôte', () => {
    expect(
      identifyCaller(
        headersOf({
          'sec-fetch-site': 'cross-site',
          referer: 'https://autre-site.example/',
          'user-agent': 'Mozilla/5.0',
        }),
        SITE_URL,
      ),
    ).toBeNull();
    expect(identifyCaller(headersOf({ 'user-agent': 'curl/8.0' }), SITE_URL)).toBeNull();
    expect(identifyCaller(headersOf({}), SITE_URL)).toBeNull();
    expect(identifyCaller(headersOf({ referer: 'not a url' }), SITE_URL)).toBeNull();
    // Même nom de domaine, autre sous-domaine : ce n'est pas la même origine.
    expect(
      identifyCaller(headersOf({ referer: 'https://evil.wakfu-companion.com/' }), SITE_URL),
    ).toBeNull();
  });
});
