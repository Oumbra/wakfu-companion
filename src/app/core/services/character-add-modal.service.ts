import { Injectable, signal } from '@angular/core';

/**
 * Pilote la modale "ajouter un personnage" (voir CharacterAddModalComponent, rendue une seule
 * fois au niveau racine — même principe que HelpModalService/ClassPickerService) : un simple
 * signal de compte ciblé, ouverte depuis le bouton "Ajouter un personnage" du panneau Personnages
 * (desktop — l'équivalent mobile reste le formulaire inline `app-character-add-form`, déjà en
 * permanence visible là où la modale ferait doublon avec le peu d'espace disponible).
 */
@Injectable({ providedIn: 'root' })
export class CharacterAddModalService {
  readonly accountId = signal<string | null>(null);

  open(accountId: string): void {
    this.accountId.set(accountId);
  }

  close(): void {
    this.accountId.set(null);
  }
}
