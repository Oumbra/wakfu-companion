import { Injectable, signal } from '@angular/core';

/** Une entrée par page légale standard du footer — la clé sert aussi de préfixe i18n
 * (`legal.<section>.title`/`legal.<section>.body`), voir LegalModalComponent. */
export type LegalSection = 'privacy' | 'terms' | 'notice';

/**
 * Pilote la modale des pages légales (confidentialité/conditions/mentions légales, voir
 * LegalModalComponent, rendue une seule fois au niveau racine — même principe que
 * HelpModalService/ClassPickerService) : ouverte depuis les liens du footer (AppFooterComponent).
 */
@Injectable({ providedIn: 'root' })
export class LegalModalService {
  readonly openSection = signal<LegalSection | null>(null);

  open(section: LegalSection): void {
    this.openSection.set(section);
  }

  close(): void {
    this.openSection.set(null);
  }
}
