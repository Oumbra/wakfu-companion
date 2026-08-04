import { Component, inject } from '@angular/core';
import { LegalPageService } from '../../core/services/legal-page.service';
import { TranslatePipe } from '../translate.pipe';

/**
 * Pied de page global — rendu une fois par panneau de navigation (voir AppPageComponent), donc
 * présent sur la page principale, la page profil ET la page légale. Les liens "Mentions légales" /
 * "Politique de confidentialité" ouvrent la page légale correspondante (voir
 * LegalPageService.open, qui délègue l'animation d'entrée à `NavigationService.openLegal()`) :
 * cette app n'a pas de routeur au sens propre, mais NavigationService anime correctement l'entrée
 * depuis la page principale OU la page profil (retour au bon endroit via `pop()`).
 */
@Component({
  selector: 'app-footer',
  imports: [TranslatePipe],
  templateUrl: './app-footer.component.html',
  styleUrl: './app-footer.component.css',
})
export class AppFooterComponent {
  protected readonly legalPage = inject(LegalPageService);
}
