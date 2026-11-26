import { Component, inject } from '@angular/core';
import { NavigationService } from '../../core/services/navigation.service';
import { OverlayBrandComponent } from '../overlay-brand/overlay-brand.component';
import { TranslatePipe } from '../translate.pipe';
import { TranslateHtmlPipe } from '../translate-html.pipe';

/**
 * Bandeau « Important » pleine largeur, sans fermeture : Chrome 157+ bloque la lecture en direct
 * de `wakfu.log` (voir `LogFileAccessService.liveTrackingBlocked`), le site ne lit qu'une copie
 * figée du fichier déposé. Recommande l'overlay pour le suivi en direct (l'action mène à l'onglet
 * Connexion du profil, où se trouvent ses téléchargements) ou un nouveau dépôt du fichier.
 *
 * Toujours affiché au-dessus de la zone de dépôt (`SetupComponent`), pour prévenir avant même le
 * dépôt, et en tête du tableau de bord quand le suivi est effectivement bloqué (`app.html`).
 * À retirer une fois le correctif de Chrome publié.
 */
@Component({
  selector: 'app-live-tracking-blocked-banner',
  imports: [OverlayBrandComponent, TranslatePipe, TranslateHtmlPipe],
  templateUrl: './live-tracking-blocked-banner.component.html',
  styleUrl: './live-tracking-blocked-banner.component.css',
})
export class LiveTrackingBlockedBannerComponent {
  private readonly nav = inject(NavigationService);

  protected openOverlay(): void {
    this.nav.openAccount();
  }
}
