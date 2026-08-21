import { Injectable, signal } from '@angular/core';
import { PurchaseRecord } from './stats-store.service';

/**
 * Requête d'ouverture de la modale de réattribution de rareté pour l'historique des achats (voir
 * PurchasesComponent) — distincte d'ItemPickerService/ItemPickerRequest (utilisé, lui, par le
 * butin et les échanges) : ici, la correction cible directement les achats individuels composant
 * la ligne agrégée (voir `records`) plutôt qu'une quantité/un montant de kamas saisis à la main,
 * devenus inutiles dès que l'utilisateur peut sélectionner les lignes exactes du cumul (voir
 * CLAUDE.md, échange avec l'utilisateur).
 */
export interface PurchaseReassignRequest {
  /** Nom tel qu'affiché sur la ligne agrégée d'origine — sert à retrouver tous les objets
   * homonymes via `CatalogService.findAllWakfuItemEntriesByName` (voir
   * PurchaseReassignPickerComponent), même principe qu'ItemPickerRequest.name. */
  name: string;
  x: number;
  y: number;
  /** Id actuellement retenu pour la ligne agrégée — sert uniquement à surligner le candidat déjà
   * choisi (jamais cliquable, voir PurchaseReassignPickerComponent.isCurrent). */
  currentId: number | null;
  /** Achats individuels composant la ligne agrégée (voir `PurchaseAggregateRow.records` dans
   * PurchasesComponent) — chacun affiché comme une ligne de détail sélectionnable indépendamment :
   * porte déjà sa propre quantité/son propre coût exacts, donc plus besoin de les ressaisir. */
  records: readonly PurchaseRecord[];
  isWatched: boolean;
  onFollow: () => void;
  /** `records` : le sous-ensemble sélectionné par l'utilisateur (jamais vide, voir
   * PurchaseReassignPickerComponent.choose) ; `catalogId` : l'id choisi. Chaque achat sélectionné
   * est réattribué EN BLOC (voir StatsStoreService.reassignPurchaseItem) — jamais scindé, la
   * sélection ligne par ligne remplace ce que faisait l'ancien découpage prorata. */
  onChosen: (records: readonly PurchaseRecord[], catalogId: number) => void;
}

/**
 * Point d'entrée unique pour ouvrir la modale de réattribution de rareté de l'historique des
 * achats — rendue une seule fois au niveau racine (`app.html`), même principe qu'ItemPickerService/
 * ClassPickerService/DamageReassignService (voir leur commentaire pour le piège `position: fixed`
 * niché dans un ancêtre `transform`, CLAUDE.md).
 */
@Injectable({ providedIn: 'root' })
export class PurchaseReassignService {
  readonly request = signal<PurchaseReassignRequest | null>(null);

  open(request: PurchaseReassignRequest): void {
    this.request.set(request);
  }

  close(): void {
    this.request.set(null);
  }
}
