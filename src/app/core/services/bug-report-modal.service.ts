import { Injectable, signal } from '@angular/core';

/**
 * Pilote la modale « Signaler un bug » (BugReportModalComponent, rendue une seule fois au niveau
 * racine — voir app.html), ouverte depuis l'icône insecte de l'en-tête du profil. Même principe
 * que HelpModalService : un simple signal d'ouverture.
 */
@Injectable({ providedIn: 'root' })
export class BugReportModalService {
  readonly isOpen = signal(false);

  open(): void {
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }
}
