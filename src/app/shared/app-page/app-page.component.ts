import { Component, input, output } from '@angular/core';
import { AppFooterComponent } from '../app-footer/app-footer.component';
import { TranslatePipe } from '../translate.pipe';
import { IconComponent } from '../icon/icon.component';

/**
 * Shell générique pour le contenu de toute page — page principale (dashboard/setup), profil,
 * mentions légales, politique de confidentialité. Structure fixe en 3 zones : en-tête de page
 * optionnel (bouton retour + titre centré en bleu capitale, affiché seulement si `title` est
 * fourni — omis pour la page principale, qui n'a pas de navigation retour), corps libre (projeté
 * via <ng-content>), pied de page (AppFooterComponent). Pour qu'un changement ici se répercute
 * identiquement sur toutes les pages.
 *
 * Le footer est délibérément placé À L'INTÉRIEUR de `.app-page-body` (après <ng-content>), donc
 * dans le flux scrollable plutôt qu'en bande fixe sous le contenu — jamais ancré à l'écran comme le
 * header du site. Pattern "sticky footer" (voir `.app-page-content { flex: 1 0 auto }` en CSS) :
 * s'il n'y a pas de scroll (contenu plus court que la page), le footer reste collé au bord bas de
 * la fenêtre ; s'il y a du scroll (contenu plus long), il ne devient visible qu'une fois scrollé
 * jusqu'en bas.
 *
 * Ne contient PAS le header du site (logo/titre/fichier/langue, voir AppHeaderComponent) : celui-ci
 * est rendu une seule fois au niveau racine (app.html), en dehors du conteneur qui anime la
 * navigation (`.view-slider`), pour que l'animation de glissement ne s'applique qu'au contenu de
 * la page (ce composant) et jamais au header du site lui-même.
 *
 * Seul `.app-page-body` scrolle : il occupe toute la largeur du panneau (pas de max-width dessus)
 * pour que la scrollbar native du navigateur reste collée au bord droit de la fenêtre, comme un
 * scroll de page entière ; le contenu projeté est libre de définir son propre wrapper centré/
 * max-width à l'intérieur (voir LegalPageComponent, ProfilePageComponent).
 */
@Component({
  selector: 'app-page',
  imports: [AppFooterComponent, TranslatePipe, IconComponent],
  templateUrl: './app-page.component.html',
  styleUrl: './app-page.component.css',
})
export class AppPageComponent {
  readonly title = input<string | null>(null);
  readonly back = output<void>();
}
