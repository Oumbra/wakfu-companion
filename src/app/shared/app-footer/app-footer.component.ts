import { Component, inject } from '@angular/core';
import { LegalModalService } from '../../core/services/legal-modal.service';
import { TranslatePipe } from '../translate.pipe';

/**
 * Pied de page global (mentions minimales) — rendu une seule fois au niveau racine (voir
 * app.html), visible sur les deux panneaux du slider (principal/profil). Les 3 liens standard
 * ouvrent la modale légale correspondante (voir LegalModalService/LegalModalComponent) plutôt que
 * de naviguer vers une page séparée : cette app n'a pas de routeur (voir NavigationService, une
 * simple bascule de vue par signal).
 */
@Component({
  selector: 'app-footer',
  imports: [TranslatePipe],
  templateUrl: './app-footer.component.html',
  styleUrl: './app-footer.component.css',
})
export class AppFooterComponent {
  protected readonly legalModal = inject(LegalModalService);
}
