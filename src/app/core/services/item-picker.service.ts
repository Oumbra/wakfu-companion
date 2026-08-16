import { Injectable, signal } from '@angular/core';

export interface ItemPickerRequest {
  /** Nom tel qu'affiché sur la ligne d'origine — sert à retrouver tous les objets homonymes via
   * `CatalogService.findAllWakfuItemEntriesByName` (voir ItemPickerComponent). */
  name: string;
  x: number;
  y: number;
  /** Id actuellement retenu pour cette ligne (résolution automatique ou correction précédente),
   * `null` si non résolu — sert uniquement à surligner le candidat déjà choisi. */
  currentId: number | null;
  onChosen: (id: number) => void;
}

/**
 * Point d'entrée unique pour ouvrir le sélecteur de correction manuelle d'objet (clic sur le bouton
 * dédié d'une ligne de butin/achat/échange — voir LootListComponent/PurchasesComponent/
 * TradesComponent) : le référentiel Ankama contient de vrais homonymes de rareté différente (ex.
 * "Larme d'Ogrest", ids 24029/21602), que la résolution automatique par nom seul
 * (`CatalogService.findWakfuItemEntry`) ne peut pas départager de façon fiable.
 *
 * Rendu une seule fois au niveau racine (`app.html`), même principe que ClassPickerService/
 * DamageReassignService : un composant niché dans un ancêtre `transform` verrait son
 * `position: fixed` recalculé relativement à cet ancêtre plutôt qu'au viewport (voir CLAUDE.md).
 */
@Injectable({ providedIn: 'root' })
export class ItemPickerService {
  readonly request = signal<ItemPickerRequest | null>(null);

  open(request: ItemPickerRequest): void {
    this.request.set(request);
  }

  close(): void {
    this.request.set(null);
  }
}
