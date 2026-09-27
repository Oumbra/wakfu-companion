import { describe, expect, it } from 'vitest';
import { detectClientOs } from './client-os.util';

const UA = {
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  linux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  firefoxLinux: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  chromeos:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};

describe('detectClientOs', () => {
  it('reconnaît Windows, Linux et macOS par le user-agent', () => {
    expect(detectClientOs({ userAgent: UA.windows })).toBe('windows');
    expect(detectClientOs({ userAgent: UA.linux })).toBe('linux');
    expect(detectClientOs({ userAgent: UA.firefoxLinux })).toBe('linux');
    expect(detectClientOs({ userAgent: UA.mac })).toBe('mac');
  });

  it('ne prend jamais un mobile ou ChromeOS pour un Linux de bureau', () => {
    expect(detectClientOs({ userAgent: UA.android })).toBe('other');
    expect(detectClientOs({ userAgent: UA.iphone })).toBe('other');
    expect(detectClientOs({ userAgent: UA.chromeos })).toBe('other');
  });

  it('préfère userAgentData quand le navigateur le fournit', () => {
    expect(detectClientOs({ userAgent: UA.windows, userAgentData: { platform: 'Linux' } })).toBe(
      'linux',
    );
    expect(
      detectClientOs({ userAgent: UA.linux, userAgentData: { platform: 'Android', mobile: true } }),
    ).toBe('other');
    expect(detectClientOs({ userAgent: UA.linux, userAgentData: { platform: 'Chrome OS' } })).toBe(
      'other',
    );
    expect(detectClientOs({ userAgent: UA.mac, userAgentData: { platform: 'macOS' } })).toBe('mac');
  });

  it('retombe sur le user-agent quand userAgentData est vide', () => {
    expect(detectClientOs({ userAgent: UA.windows, userAgentData: { platform: '' } })).toBe(
      'windows',
    );
  });
});
