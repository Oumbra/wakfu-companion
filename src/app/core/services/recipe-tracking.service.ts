import { Injectable, signal } from '@angular/core';

export interface RecipeTrackingIngredient {
  name: string;
  /** Quantité de cet ingrédient nécessaire pour UNE unité de l'objet source. */
  quantity: number;
  /** Vrai si cet ingrédient a lui-même une recette connue — voir RecipeQuantityModalComponent
   * (icône "imbriquer les ingrédients de cet objet"). */
  hasRecipe: boolean;
  /** Ingrédients de la recette de CET ingrédient (1 seul niveau) — vide si `hasRecipe` est faux. */
  recipeIngredients: readonly { name: string; quantity: number }[];
}

export interface RecipeTrackingRequest {
  /** Nom affiché (langue courante) de l'objet source dont on veut suivre les ingrédients. */
  itemLabel: string;
  ingredients: readonly RecipeTrackingIngredient[];
}

/**
 * Pilote la modale "suivre les objets de la recette" (voir RecipeQuantityModalComponent, rendue
 * une seule fois au niveau racine — même principe que HelpModalService/ClassPickerService) :
 * ouverte depuis l'icône recette de WakfuAutocompleteComponent sur un objet `hasRecipe`.
 */
@Injectable({ providedIn: 'root' })
export class RecipeTrackingService {
  readonly request = signal<RecipeTrackingRequest | null>(null);

  open(request: RecipeTrackingRequest): void {
    this.request.set(request);
  }

  close(): void {
    this.request.set(null);
  }
}
