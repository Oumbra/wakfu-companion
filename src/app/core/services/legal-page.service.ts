import { Injectable, inject, signal } from '@angular/core';
import { NavigationService } from './navigation.service';

/**
 * Pilote l'affichage de la page légale (mentions légales, voir LegalPageComponent) : ouverte
 * depuis le lien du footer (AppFooterComponent), rendue comme un 3ᵉ état de `app-main` (aux côtés
 * de `app-dashboard`/`app-setup`, voir app.html) plutôt qu'en modale — header et footer
 * applicatifs restent visibles, comme une vraie page dédiée. Seule la page "Mentions légales"
 * subsiste (confidentialité/conditions retirées à la demande) ; un simple booléen suffit donc,
 * plus besoin d'une union de sections.
 */
@Injectable({ providedIn: 'root' })
export class LegalPageService {
  private readonly nav = inject(NavigationService);

  readonly isOpen = signal(false);

  open(): void {
    this.isOpen.set(true);
    this.nav.goToMain();
  }

  close(): void {
    this.isOpen.set(false);
  }
}
