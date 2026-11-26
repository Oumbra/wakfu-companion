import { Component, computed, inject, signal } from '@angular/core';
import { AppUpdateService } from '../../core/services/app-update.service';
import { LogFileAccessService } from '../../core/services/log-file-access.service';
import { NavigationService } from '../../core/services/navigation.service';
import { OverlayConflictService } from '../../core/services/overlay-conflict.service';
import { AnnouncementCardComponent } from '../announcement-card/announcement-card.component';
import { TranslatePipe } from '../translate.pipe';
import { TranslateHtmlPipe } from '../translate-html.pipe';

/**
 * Avertissement « Important » (carte `app-announcement-card`) affiché quand le navigateur bloque la
 * lecture en direct de `wakfu.log` (`LogFileAccessService.liveTrackingBlocked`) : le site n'a lu
 * qu'une copie figée du fichier. Recommande l'overlay pour le suivi en direct (l'action mène à
 * l'onglet Connexion du profil, où se trouvent ses téléchargements) ou un nouveau dépôt du fichier.
 *
 * Rendue au niveau racine (`app.html`) ; s'efface devant la bannière de mise à jour du site et
 * devant l'avertissement « fichier lu en double », et masque la bannière d'annonce de l'overlay.
 * « Plus tard » la ferme jusqu'au prochain rechargement de la page.
 */
@Component({
  selector: 'app-live-tracking-blocked-notice',
  imports: [AnnouncementCardComponent, TranslatePipe, TranslateHtmlPipe],
  templateUrl: './live-tracking-blocked-notice.component.html',
  styleUrl: './live-tracking-blocked-notice.component.css',
})
export class LiveTrackingBlockedNoticeComponent {
  private readonly logFileAccess = inject(LogFileAccessService);
  private readonly updateService = inject(AppUpdateService);
  private readonly conflict = inject(OverlayConflictService);
  private readonly nav = inject(NavigationService);
  private readonly dismissed = signal(false);

  protected readonly show = computed(
    () =>
      this.logFileAccess.liveTrackingBlocked() &&
      !this.dismissed() &&
      !this.updateService.updateReady() &&
      !this.conflict.show(),
  );

  protected dismiss(): void {
    this.dismissed.set(true);
  }

  protected openOverlay(): void {
    this.dismissed.set(true);
    this.nav.openAccount();
  }
}
