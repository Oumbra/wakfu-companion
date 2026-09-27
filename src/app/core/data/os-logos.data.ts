import type { OverlayPlatform } from '../services/overlay-release.service';

/** Logos des systèmes (PNG transparents, `public/assets/ui/`, nom hashé : régénérer le hash si
 * le fichier change — provenance dans `public/assets/SOURCES.md`). */
export const OS_LOGOS: Record<OverlayPlatform, string> = {
  windows: 'assets/ui/os-windows-b0ca3239.png',
  linux: 'assets/ui/os-linux-490667e8.png',
};
