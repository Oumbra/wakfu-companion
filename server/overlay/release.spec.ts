import { describe, expect, it } from 'vitest';
import {
  downloadHeaders,
  isOverlayPlatform,
  isTrustedGithubDownloadUrl,
  overlayAssetUrl,
  parseOverlayManifest,
  summarizeRelease,
} from './release';

/** Forme réelle du manifeste publié par `release.yml` du dépôt de l'overlay (v0.82.10). */
function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    channel: 'stable',
    version: '0.82.10',
    commit: '9dba8a3',
    publishedAt: '2026-09-24T12:38:20Z',
    notesUrl: 'https://github.com/Oumbra/wakfu-companion-overlay/releases/tag/v0.82.10',
    assets: {
      'linux-x86_64': {
        name: 'wakfu-companion-overlay-0.82.10-linux-x86_64.gz',
        size: 16656521,
        sha256: 'acc3ca49e94a76c6a3cbe9b36cdd9c3beceaa5f7ed48f974b22ac2bbc4963f84',
        installed: { size: 34045088, sha256: '51f3d0e8' },
      },
      'windows-x86_64': {
        name: 'wakfu-companion-overlay-0.82.10-windows-x86_64.exe.gz',
        size: 13528458,
        sha256: '596d47dc',
        installed: { size: 28398080, sha256: 'c6ab9a8b' },
      },
    },
    deltas: {},
    ...overrides,
  };
}

describe('manifeste de l’overlay', () => {
  it('lit la version et les assets des deux plateformes', () => {
    const release = parseOverlayManifest(manifest());
    expect(release).toEqual({
      version: '0.82.10',
      publishedAt: '2026-09-24T12:38:20Z',
      notesUrl: 'https://github.com/Oumbra/wakfu-companion-overlay/releases/tag/v0.82.10',
      assets: {
        windows: {
          name: 'wakfu-companion-overlay-0.82.10-windows-x86_64.exe.gz',
          size: 13528458,
          installedSize: 28398080,
        },
        linux: {
          name: 'wakfu-companion-overlay-0.82.10-linux-x86_64.gz',
          size: 16656521,
          installedSize: 34045088,
        },
      },
    });
    expect(summarizeRelease(release!).platforms).toEqual({
      windows: { size: 13528458, installedSize: 28398080 },
      linux: { size: 16656521, installedSize: 34045088 },
    });
  });

  it('refuse un schéma inconnu ou une version mal formée', () => {
    expect(parseOverlayManifest(manifest({ schema: 2 }))).toBeNull();
    expect(parseOverlayManifest(manifest({ version: '../evil' }))).toBeNull();
    expect(parseOverlayManifest(null)).toBeNull();
    expect(parseOverlayManifest([])).toBeNull();
  });

  it('écarte un asset dont le nom sortirait du motif attendu ou d’une autre version', () => {
    const release = parseOverlayManifest(
      manifest({
        assets: {
          'linux-x86_64': { name: '../../../evil.gz', size: 10 },
          'windows-x86_64': {
            name: 'wakfu-companion-overlay-0.80.0-windows-x86_64.exe.gz',
            size: 10,
          },
        },
      }),
    );
    expect(release?.assets).toEqual({});
  });

  it('ignore une URL de notes hors du dépôt de l’overlay', () => {
    expect(parseOverlayManifest(manifest({ notesUrl: 'https://evil.example/x' }))?.notesUrl).toBe(
      null,
    );
  });

  it('construit l’URL de l’asset sur le tag de la version, jamais sur `latest`', () => {
    const release = parseOverlayManifest(manifest())!;
    expect(overlayAssetUrl(release, 'windows')).toBe(
      'https://github.com/Oumbra/wakfu-companion-overlay/releases/download/v0.82.10/wakfu-companion-overlay-0.82.10-windows-x86_64.exe.gz',
    );
    expect(overlayAssetUrl({ ...release, assets: {} }, 'linux')).toBeNull();
  });
});

describe('relais du binaire', () => {
  it('ne connaît que Windows et Linux', () => {
    expect(isOverlayPlatform('windows')).toBe(true);
    expect(isOverlayPlatform('linux')).toBe(true);
    expect(isOverlayPlatform('mac')).toBe(false);
    expect(isOverlayPlatform('toString')).toBe(false);
  });

  it('n’accepte que GitHub et son stockage d’assets comme destination finale', () => {
    expect(isTrustedGithubDownloadUrl('https://github.com/Oumbra/x')).toBe(true);
    expect(isTrustedGithubDownloadUrl('https://release-assets.githubusercontent.com/a')).toBe(true);
    expect(isTrustedGithubDownloadUrl('http://github.com/x')).toBe(false);
    expect(isTrustedGithubDownloadUrl('https://github.com.evil.example/x')).toBe(false);
    expect(isTrustedGithubDownloadUrl('pas une url')).toBe(false);
  });

  it('fait enregistrer le binaire décompressé sous un nom stable', () => {
    expect(downloadHeaders('windows', '0.82.10')).toMatchObject({
      'content-encoding': 'gzip',
      'content-disposition': 'attachment; filename="wakfu-companion-overlay.exe"',
    });
    expect(downloadHeaders('linux', '0.82.10')['content-disposition']).toBe(
      'attachment; filename="wakfu-companion-overlay"',
    );
  });
});
