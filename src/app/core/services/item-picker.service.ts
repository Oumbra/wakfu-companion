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
  /** Quantité totale de la ligne d'origine — borne haute du stepper de quantité affiché quand une
   * correction est possible (voir `onChosen`) : la correction ne porte pas forcément sur la
   * totalité du lot (ex. 2 des 5 objets ramassés étaient en réalité l'autre variante). */
  quantity: number;
  /** Vrai si l'objet est déjà suivi (voir StatsStoreService.isWatched) — désactive le bouton
   * "+ Suivre" du menu. Capturé à l'ouverture, comme `currentId` : pas recalculé en continu tant
   * que le menu reste ouvert. */
  isWatched: boolean;
  onFollow: () => void;
  /** Absent : aucune section de correction n'est proposée (ex. butin cumulé de session, qui
   * n'a pas de combat unique à cibler — voir LootListComponent.fight), seul "+ Suivre" reste
   * offert. Présent : `(id, quantity)` — `quantity` est la valeur choisie dans le stepper, jamais
   * plus que `ItemPickerRequest.quantity` ni moins que 1. */
  onChosen?: (id: number, quantity: number) => void;
}

/**
 * Point d'entrée unique pour ouvrir le menu d'interaction avec un objet (clic droit sur une ligne
 * de butin/achat/échange — voir LootListComponent/PurchasesComponent/TradesComponent) : suivi
 * (ajout à la watchlist) et, si le référentiel Ankama contient plusieurs objets de ce nom
 * (homonymes de rareté différente, ex. "Larme d'Ogrest", ids 24029/21602 — la résolution
 * automatique par nom seul via `CatalogService.findWakfuItemEntry` ne peut pas les départager),
 * correction manuelle de l'id retenu.
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
