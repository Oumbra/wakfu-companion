import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import {
  OverlayReleaseService,
  type OverlayPlatform,
} from '../../core/services/overlay-release.service';
import { I18nService } from '../../core/services/i18n.service';
import { TranslatePipe } from '../translate.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';

/**
 * Téléchargement de l'overlay de bureau (onglet Connexion du profil, bloc « Overlay de bureau ») :
 * le bouton du système détecté (Windows : `.exe` prêt à lancer ; Linux : commande d'installation
 * ou script, binaire seul en repli), un message pour macOS/mobile où l'overlay n'existe pas, et un
 * sélecteur pour télécharger la version d'un AUTRE système (préparer l'installation sur un autre
 * PC). Toujours la dernière Release publiée : voir `OverlayReleaseService`.
 */
@Component({
  selector: 'app-overlay-download',
  imports: [TranslatePipe, TooltipDirective],
  templateUrl: './overlay-download.component.html',
  styleUrl: './overlay-download.component.css',
})
export class OverlayDownloadComponent implements OnInit, OnDestroy {
  protected readonly overlay = inject(OverlayReleaseService);
  private readonly i18n = inject(I18nService);

  /** Plateforme affichée : celle du visiteur si l'overlay y tourne, sinon aucune tant qu'il n'en
   * choisit pas une dans le sélecteur. */
  protected readonly platform = signal<OverlayPlatform | null>(
    this.overlay.clientOs === 'windows' || this.overlay.clientOs === 'linux'
      ? this.overlay.clientOs
      : null,
  );

  protected readonly platforms: readonly OverlayPlatform[] = ['windows', 'linux'];

  protected readonly copied = signal(false);
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;

  /** « Version 0.82.10 · 24 septembre 2026 », ou `null` tant que la version n'est pas connue. */
  protected readonly versionLabel = computed(() => {
    const release = this.overlay.release();
    if (!release) return null;
    const date = release.publishedAt
      ? new Date(release.publishedAt).toLocaleDateString(this.i18n.locale(), { dateStyle: 'long' })
      : null;
    return this.i18n.t(date ? 'overlay.download.versionDated' : 'overlay.download.version', {
      version: release.version,
      date,
    });
  });

  /** Taille du fichier téléchargé (binaire décompressé, ce qu'affiche le navigateur à la fin). */
  protected sizeLabel(platform: OverlayPlatform): string | null {
    const size = this.overlay.release()?.platforms[platform]?.installedSize;
    if (!size) return null;
    return this.i18n.t('overlay.download.size', { n: Math.round(size / (1024 * 1024)) });
  }

  ngOnInit(): void {
    void this.overlay.loadRelease();
  }

  ngOnDestroy(): void {
    clearTimeout(this.copiedTimer);
  }

  /** Un téléchargement lancé rend la bannière d'annonce sans objet. */
  protected onDownload(): void {
    this.overlay.dismissAnnouncement();
  }

  protected async copyCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.overlay.linuxInstallCommand);
    } catch {
      return;
    }
    this.onDownload();
    this.copied.set(true);
    clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => this.copied.set(false), 2000);
  }
}
