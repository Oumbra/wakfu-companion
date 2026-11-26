import { Component, inject, input, signal } from '@angular/core';
import { NavigationService } from '../../core/services/navigation.service';
import { OverlayBrandComponent } from '../overlay-brand/overlay-brand.component';
import { TranslatePipe } from '../translate.pipe';
import { TranslateHtmlPipe } from '../translate-html.pipe';

/** Clé `localStorage` (préférence locale non synchronisée) : bandeau du tableau de bord replié. */
const COLLAPSED_STORAGE_KEY = 'wakfu-live-tracking-banner-collapsed';

/**
 * Avertissement « Important » permanent, sans fermeture : Chrome 157+ bloque la lecture en direct
 * de `wakfu.log` (voir `LogFileAccessService.liveTrackingBlocked`), le site ne lit qu'une copie
 * figée du fichier déposé. Recommande l'overlay pour le suivi en direct (l'action mène à l'onglet
 * Connexion du profil, où se trouvent ses téléchargements) ou un nouveau dépôt du fichier.
 *
 * Même disposition que les cartes d'annonce (`app-announcement-card`) : marque et pastille, puis
 * titre, texte et action. Deux variantes :
 * - `card` : cadre au-dessus de la zone de dépôt (`SetupComponent`), toujours affiché pour
 *   prévenir avant même le dépôt ;
 * - `band` : bandeau fin pleine largeur en tête du tableau de bord (`app.html`) quand le suivi est
 *   effectivement bloqué, repliable sur une seule ligne (marque, titre, action), choix mémorisé.
 *
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

  readonly variant = input<'card' | 'band'>('card');

  protected readonly collapsed = signal(readCollapsed());

  protected openOverlay(): void {
    this.nav.openAccount();
  }

  protected toggleCollapsed(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Stockage indisponible (navigation privée...) : le choix vaut pour la page en cours.
    }
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
