import { Injectable, inject, signal } from '@angular/core';
import { NavigationService } from './navigation.service';

export type LegalPageKind = 'notice' | 'privacy';

/**
 * Pilote le contenu affiché par la page légale (mentions légales + politique de confidentialité,
 * voir LegalPageComponent) : ouverte/fermée depuis les liens du footer (AppFooterComponent) via
 * NavigationService, qui gère l'animation d'entrée/sortie (voir NavigationService.openLegal/pop) —
 * ce service ne porte plus que le choix du contenu (`kind`), plus d'état ouvert/fermé séparé
 * (redondant avec `NavigationService.view() === 'legal'`).
 */
@Injectable({ providedIn: 'root' })
export class LegalPageService {
  private readonly nav = inject(NavigationService);

  readonly kind = signal<LegalPageKind>('notice');

  open(kind: LegalPageKind = 'notice'): void {
    this.kind.set(kind);
    this.nav.openLegal();
  }

  close(): void {
    this.nav.pop();
  }
}
