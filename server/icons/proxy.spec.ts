import { describe, expect, it } from 'vitest';
import { HIT_MAX_AGE_SECONDS, MISS_MAX_AGE_SECONDS, relayHeaders, upstreamUrl } from './proxy';

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

  it('relaie les bonus PA/PM des sorts de monstres (timePointBonus)', () => {
    expect(upstreamUrl({ folder: 'timePointBonus', file: '9.png' })).toBe(
      'https://vertylo.github.io/wakassets/timePointBonus/9.png',
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
});
