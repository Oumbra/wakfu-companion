/** Système d'exploitation du visiteur, du point de vue de l'overlay de bureau (publié pour Windows
 * et Linux x86_64 seulement — voir `server/overlay/release.ts`). `'other'` regroupe mobiles
 * (Android, iOS), ChromeOS et tout système non reconnu. */
export type ClientOs = 'windows' | 'linux' | 'mac' | 'other';

/** Sous-ensemble de `Navigator` lu ici (`userAgentData` n'existe que dans les navigateurs
 * Chromium, d'où le repli sur `userAgent`). */
export interface ClientOsSource {
  userAgent: string;
  userAgentData?: { platform?: string; mobile?: boolean };
}

/**
 * Déduit le système du visiteur. `navigator.userAgentData.platform` (Chromium) prime quand il est
 * renseigné ; sinon, lecture du `userAgent`. Android s'annonce « Linux » dans son user-agent et
 * ChromeOS « X11 » : ils sont testés AVANT Linux, faute de quoi un téléphone se verrait proposer
 * le binaire Linux. Les iPad récents s'annoncent « Macintosh » : ils restent classés `mac`, ce qui
 * affiche le même message (overlay non disponible) qu'un vrai Mac.
 */
export function detectClientOs(source: ClientOsSource): ClientOs {
  const platform = source.userAgentData?.platform?.toLowerCase() ?? '';
  if (platform) {
    if (source.userAgentData?.mobile) return 'other';
    if (platform === 'windows') return 'windows';
    if (platform === 'macos') return 'mac';
    if (platform === 'linux') return 'linux';
    if (platform !== 'unknown') return 'other';
  }

  const ua = source.userAgent.toLowerCase();
  if (/android|iphone|ipad|ipod|cros/.test(ua)) return 'other';
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('mac os x') || ua.includes('macintosh')) return 'mac';
  if (ua.includes('linux') || ua.includes('x11')) return 'linux';
  return 'other';
}
