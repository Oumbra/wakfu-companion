import { Injectable, signal } from '@angular/core';

export interface ItemPickerRequest {
  /** Nom tel qu'affiché sur la ligne d'origine — sert à retrouver tous les objets homonymes via
   * `CatalogService.findAllWakfuItemEntriesByName` (voir ItemPickerComponent). */
  name: string;
  x: number;
  y: number;
  /** Id actuellement retenu pour cette ligne (résolution automatique ou correction précédente),
   * `null` si non résolu — sert uniquement à surligner le candidat déjà choisi (jamais cliquable,
   * voir ItemPickerComponent.isCurrent). */
  currentId: number | null;
  /** Quantité totale de la ligne d'origine — borne haute du stepper de quantité affiché pour la
   * correction : elle ne porte pas forcément sur la totalité du lot (ex. 2 des 5 objets ramassés
   * étaient en réalité l'autre variante). */
  quantity: number;
  /** `(id, quantity)` — `quantity` est la valeur choisie dans le stepper, jamais plus que
   * `ItemPickerRequest.quantity` ni moins que 1. Toujours requis : ce menu ne propose plus QUE la
   * correction d'homonyme (voir CLAUDE.md, bouton "Suivre" retiré) — un appelant qui n'a rien à
   * corriger (ex. butin cumulé de session, sans combat unique à cibler, voir LootListComponent.fight)
   * ne doit tout simplement pas ouvrir ce menu. Achats (voir PurchasesComponent) : ne passe pas par
   * ce menu générique, voir PurchaseReassignService (modale dédiée, suivi + sélection des lignes de
   * détail plutôt qu'un stepper quantité/kamas). */
  onChosen: (id: number, quantity: number) => void;
}

/**
 * Point d'entrée unique pour ouvrir le menu de correction manuelle d'un objet homonyme (clic droit
 * sur une ligne de butin/échange — voir LootListComponent/TradesComponent ; l'historique des achats
 * a sa propre modale dédiée, voir PurchaseReassignService) : quand le référentiel Ankama contient
 * plusieurs objets de ce nom (homonymes de rareté différente, ex. "Larme d'Ogrest", ids 24029/21602
 * — la résolution automatique par nom seul via `CatalogService.findWakfuItemEntry` ne peut pas les
 * départager), corrige manuellement l'id retenu. Aucun suivi (watchlist) ici — voir CLAUDE.md, le
 * bouton "+ Suivre" a été retiré de ce menu : un appelant doit s'assurer qu'un homonyme existe
 * réellement (voir `CatalogService.findAllWakfuItemEntriesByName(name).length > 1`) avant d'ouvrir,
 * sans quoi le menu n'aurait rien à proposer.
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
