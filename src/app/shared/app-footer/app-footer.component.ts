import { Component, inject } from '@angular/core';
import { LegalPageService } from '../../core/services/legal-page.service';
import { TranslatePipe } from '../translate.pipe';

/**
 * Pied de page global (mentions minimales) — rendu une seule fois au niveau racine (voir
 * app.html), visible sur les deux panneaux du slider (principal/profil). Le lien "Mentions
 * légales" ouvre la page légale (voir LegalPageService/LegalPageComponent, rendue comme un 3ᵉ état
 * de `app-main` plutôt qu'une modale) : cette app n'a pas de routeur au sens propre (voir
 * NavigationService), mais `LegalPageService.open()` bascule aussi sur la vue principale
 * (`nav.goToMain()`) pour que la page légale soit visible même si on cliquait depuis le footer
 * affiché sur la vue profil.
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
