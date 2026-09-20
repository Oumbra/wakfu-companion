import { describe, expect, it } from 'vitest';
import { proxyWakassetsUrl, wakassetsIconUrl } from './wakassets-url.util';

describe('wakassets-url.util', () => {
  it('construit une URL relayée à partir du dossier et du fichier', () => {
    expect(wakassetsIconUrl('items', '1234.png')).toBe('/api/v1/icons/items/1234.png');
    expect(wakassetsIconUrl('bossIllustrations', 'default.png')).toBe(
      '/api/v1/icons/bossIllustrations/default.png',
    );
  });

  it('réécrit une URL amont wakassets vers le relais', () => {
    expect(proxyWakassetsUrl('https://vertylo.github.io/wakassets/monstersfamily/68.png')).toBe(
      '/api/v1/icons/monstersfamily/68.png',
    );
  });

  it('laisse intacte toute autre URL', () => {
    expect(proxyWakassetsUrl('https://static.ankama.com/wakfu/portal/game/item/115/1.png')).toBe(
      'https://static.ankama.com/wakfu/portal/game/item/115/1.png',
    );
    expect(proxyWakassetsUrl('/api/v1/icons/items/1.png')).toBe('/api/v1/icons/items/1.png');
    expect(proxyWakassetsUrl(null)).toBeNull();
    expect(proxyWakassetsUrl(undefined)).toBeUndefined();
    // Même origine mais pas le dépôt wakassets : pas à nous de relayer.
    expect(proxyWakassetsUrl('https://vertylo.github.io/autre/1.png')).toBe(
      'https://vertylo.github.io/autre/1.png',
    );
  });
});
