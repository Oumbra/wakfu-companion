import { Component, inject } from '@angular/core';
import { AppUpdateService } from '../../core/services/app-update.service';
import { NavigationService } from '../../core/services/navigation.service';
import { OverlayReleaseService } from '../../core/services/overlay-release.service';
import { TranslatePipe } from '../translate.pipe';

/**
 * Bannière « l'overlay de bureau est disponible », rendue au niveau racine (`app.html`, même
 * emplacement que `<app-update-notice>`). Affichée aux utilisateurs connectés sous Windows ou
 * Linux (voir `OverlayReleaseService.showAnnouncement`) ; un clic mène à l'onglet Connexion du
 * profil, où se trouvent les boutons de téléchargement, et ferme définitivement la bannière — tout
 * comme « Plus tard » ou un téléchargement lancé depuis cet onglet.
 *
 * S'efface devant la bannière de mise à jour du site (même position, plus urgente).
 */
@Component({
  selector: 'app-overlay-announcement',
  imports: [TranslatePipe],
  templateUrl: './overlay-announcement.component.html',
  styleUrl: './overlay-announcement.component.css',
})
export class OverlayAnnouncementComponent {
  protected readonly overlay = inject(OverlayReleaseService);
  protected readonly updateService = inject(AppUpdateService);
  private readonly nav = inject(NavigationService);

  protected open(): void {
    this.overlay.dismissAnnouncement();
    this.nav.openAccount();
  }

  protected dismiss(): void {
    this.overlay.dismissAnnouncement();
  }
}
