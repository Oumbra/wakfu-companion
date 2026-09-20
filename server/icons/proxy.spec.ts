import { describe, expect, it } from 'vitest';
import {
  HIT_MAX_AGE_SECONDS,
  MISS_MAX_AGE_SECONDS,
  identifyCaller,
  relayHeaders,
  upstreamUrl,
} from './proxy';

const headersOf = (entries: Record<string, string>) => ({
  get: (name: string) => entries[name.toLowerCase()] ?? null,
});
const SITE_URL = 'https://wakfu-companion.com/api/v1/icons/items/1234.png';

describe('relais d’icônes wakassets', () => {
  it('reconstruit l’URL amont pour chaque dossier connu', () => {
    expect(upstreamUrl({ folder: 'items', file: '1234.png' })).toBe(
      'https://vertylo.github.io/wakassets/items/1234.png',
    );
    expect(upstreamUrl({ folder: 'monsterIllustrations', file: '5421.png' })).toBe(
      'https://vertylo.github.io/wakassets/monsterIllustrations/5421.png',
    );
    expect(upstreamUrl({ folder: 'spells', file: '6262.png' })).toBe(
      'https://vertylo.github.io/wakassets/spells/6262.png',
    );
  });

  it('accepte les dossiers et noms non numériques que le site utilise', () => {
    expect(upstreamUrl({ folder: 'bossIllustrations', file: 'default.png' })).toBe(
      'https://vertylo.github.io/wakassets/bossIllustrations/default.png',
    );
    expect(upstreamUrl({ folder: 'monstersfamily', file: '68.png' })).toBe(
      'https://vertylo.github.io/wakassets/monstersfamily/68.png',
    );
    expect(upstreamUrl({ folder: 'icons', file: 'di.png' })).toBe(
      'https://vertylo.github.io/wakassets/icons/di.png',
    );
    expect(upstreamUrl({ folder: 'aptitudes', file: '234.png' })).toBe(
      'https://vertylo.github.io/wakassets/aptitudes/234.png',
    );
    expect(upstreamUrl({ folder: 'itemTypes', file: '-1.png' })).toBe(
      'https://vertylo.github.io/wakassets/itemTypes/-1.png',
    );
  });

  it('refuse tout ce qui n’est pas <dossier connu>/<nombre ou mot court>.png', () => {
    expect(upstreamUrl({ folder: 'autre', file: '1.png' })).toBeNull();
    expect(upstreamUrl({ folder: 'items', file: '1.jpg' })).toBeNull();
    expect(upstreamUrl({ folder: 'items', file: '../1.png' })).toBeNull();
    expect(upstreamUrl({ folder: 'items', file: '..png' })).toBeNull();
    expect(upstreamUrl({ folder: 'items', file: 'Abc.png' })).toBeNull();
    expect(upstreamUrl({ folder: 'items', file: 'a-b.png' })).toBeNull();
    expect(upstreamUrl({ folder: 'items', file: '--1.png' })).toBeNull();
    expect(upstreamUrl({ folder: 'items', file: 'abcdefghijklmnopq.png' })).toBeNull();
    expect(upstreamUrl({ folder: 'items', file: '' })).toBeNull();
    expect(upstreamUrl({ folder: '', file: '1.png' })).toBeNull();
    expect(upstreamUrl({ folder: 'items', file: '1.png?x=1' })).toBeNull();
  });

  it('cache longtemps une icône trouvée, peu un 404', () => {
    const hit = relayHeaders(200);
    expect(hit['content-type']).toBe('image/png');
    expect(hit['cache-control']).toBe(`public, max-age=${HIT_MAX_AGE_SECONDS}`);
    const miss = relayHeaders(404);
    expect(miss['content-type']).toBe('application/json');
    expect(miss['cache-control']).toBe(`public, max-age=${MISS_MAX_AGE_SECONDS}`);
    expect(MISS_MAX_AGE_SECONDS).toBeLessThan(HIT_MAX_AGE_SECONDS);
    expect(hit['access-control-allow-origin']).toBeUndefined();
  });

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
