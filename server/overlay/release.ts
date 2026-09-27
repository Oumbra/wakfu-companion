/**
 * Téléchargement de l'overlay de bureau (`wakfu-companion-overlay`) depuis le site — logique pure,
 * testée sans infrastructure ; les routes vivent sous `functions/api/v1/overlay/`.
 *
 * Source de vérité : le manifeste `latest.json` publié à chaque Release par le workflow
 * `release.yml` du dépôt de l'overlay (schéma §5 de son `docs/plan-mise-a-jour.md`), à une URL
 * stable (`releases/latest/download/…`, hors API GitHub, donc sans quota). C'est le même manifeste
 * que l'overlay lit pour se mettre à jour seul : le site propose donc toujours la version que
 * l'overlay installerait lui-même, sans rien à modifier ici à chaque Release.
 *
 * Les binaires sont publiés compressés en gzip simple (`….exe.gz`, `….gz`), que l'Explorateur
 * Windows n'ouvre pas nativement. Le relais (`functions/api/v1/overlay/download/[platform].ts`)
 * renvoie les octets gzip TELS QUELS avec `Content-Encoding: gzip` : le navigateur décompresse à
 * la volée et enregistre directement le `.exe` (ou le binaire Linux), sans que le Worker ait à
 * décompresser quoi que ce soit (aucun coût CPU, simple flux).
 */

export const OVERLAY_REPOSITORY = 'Oumbra/wakfu-companion-overlay';
export const OVERLAY_RELEASES_URL = `https://github.com/${OVERLAY_REPOSITORY}/releases`;
export const OVERLAY_MANIFEST_URL = `${OVERLAY_RELEASES_URL}/latest/download/latest.json`;

/** Plateformes publiées par l'overlay (clés `assets` du manifeste) et nom côté URL du site. */
export const OVERLAY_PLATFORMS = {
  windows: { assetKey: 'windows-x86_64', fileName: 'wakfu-companion-overlay.exe' },
  linux: { assetKey: 'linux-x86_64', fileName: 'wakfu-companion-overlay' },
} as const;

export type OverlayPlatform = keyof typeof OVERLAY_PLATFORMS;

export interface OverlayAsset {
  /** Nom de l'asset gzip dans la Release (`wakfu-companion-overlay-0.82.10-linux-x86_64.gz`). */
  name: string;
  /** Taille compressée (octets transférés). */
  size: number;
  /** Taille du binaire une fois décompressé. */
  installedSize: number;
}

export interface OverlayRelease {
  version: string;
  publishedAt: string | null;
  notesUrl: string | null;
  assets: Partial<Record<OverlayPlatform, OverlayAsset>>;
}

/** Réponse publique de `GET /api/v1/overlay/latest` (lue par `OverlayReleaseService`). */
export interface OverlayReleaseSummary {
  version: string;
  publishedAt: string | null;
  notesUrl: string | null;
  platforms: Partial<Record<OverlayPlatform, { size: number; installedSize: number }>>;
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
/** Nom d'asset attendu, version comprise : rien d'autre ne sera jamais concaténé à une URL. */
const ASSET_NAME_PATTERN =
  /^wakfu-companion-overlay-\d+\.\d+\.\d+-(?:windows-x86_64\.exe|linux-x86_64)\.gz$/;

export function isOverlayPlatform(value: string): value is OverlayPlatform {
  return Object.hasOwn(OVERLAY_PLATFORMS, value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Valide le manifeste amont et n'en garde que ce que le site utilise. `null` si le manifeste est
 * inexploitable (schéma inconnu, version absente) ; un asset mal formé est simplement ignoré — sa
 * plateforme n'est alors pas proposée, les autres le restent.
 */
export function parseOverlayManifest(raw: unknown): OverlayRelease | null {
  const manifest = asRecord(raw);
  if (!manifest || manifest['schema'] !== 1) return null;
  const version = manifest['version'];
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) return null;

  const rawAssets = asRecord(manifest['assets']) ?? {};
  const assets: OverlayRelease['assets'] = {};
  for (const [platform, { assetKey }] of Object.entries(OVERLAY_PLATFORMS)) {
    const asset = asRecord(rawAssets[assetKey]);
    if (!asset) continue;
    const name = asset['name'];
    const size = positiveInteger(asset['size']);
    const installedSize = positiveInteger(asRecord(asset['installed'])?.['size']);
    if (typeof name !== 'string' || !ASSET_NAME_PATTERN.test(name) || !size) continue;
    if (!name.includes(`-${version}-${assetKey}`)) continue;
    assets[platform as OverlayPlatform] = { name, size, installedSize: installedSize ?? size };
  }

  const publishedAt = manifest['publishedAt'];
  const notesUrl = manifest['notesUrl'];
  return {
    version,
    publishedAt: typeof publishedAt === 'string' ? publishedAt : null,
    notesUrl:
      typeof notesUrl === 'string' && notesUrl.startsWith(`${OVERLAY_RELEASES_URL}/`)
        ? notesUrl
        : null,
    assets,
  };
}

export function summarizeRelease(release: OverlayRelease): OverlayReleaseSummary {
  const platforms: OverlayReleaseSummary['platforms'] = {};
  for (const [platform, asset] of Object.entries(release.assets)) {
    platforms[platform as OverlayPlatform] = {
      size: asset.size,
      installedSize: asset.installedSize,
    };
  }
  return {
    version: release.version,
    publishedAt: release.publishedAt,
    notesUrl: release.notesUrl,
    platforms,
  };
}

/** URL de l'asset gzip d'une version précise (tag `v{version}`, jamais `latest` : le binaire
 * servi correspond forcément au manifeste lu, même si une Release sort entre les deux requêtes). */
export function overlayAssetUrl(release: OverlayRelease, platform: OverlayPlatform): string | null {
  const asset = release.assets[platform];
  if (!asset) return null;
  return `${OVERLAY_RELEASES_URL}/download/v${release.version}/${asset.name}`;
}

/**
 * Hôtes où une redirection de GitHub peut mener : `github.com` redirige chaque téléchargement
 * d'asset vers son stockage (`release-assets.githubusercontent.com`, anciennement
 * `objects.githubusercontent.com`). Toute autre destination finale est refusée.
 */
export function isTrustedGithubDownloadUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return parsed.hostname === 'github.com' || parsed.hostname.endsWith('.githubusercontent.com');
}

/**
 * En-têtes du binaire relayé. `Content-Encoding: gzip` sur des octets gzip : le navigateur les
 * décompresse et enregistre le binaire sous `fileName` (un navigateur ne saute ce décodage que pour
 * un fichier qu'il voit comme une archive `.gz`, ce que ni le nom ni le type ne suggèrent ici).
 * `no-transform` : aucun intermédiaire ne doit recompresser ou décoder ce flux.
 */
export function downloadHeaders(
  platform: OverlayPlatform,
  version: string,
): Record<string, string> {
  const { fileName } = OVERLAY_PLATFORMS[platform];
  return {
    'content-type': 'application/octet-stream',
    'content-encoding': 'gzip',
    'content-disposition': `attachment; filename="${fileName}"`,
    'cache-control': 'private, no-store, no-transform',
    'x-overlay-version': version,
  };
}
