import { Injectable, signal } from '@angular/core';
import { WakfuRarity } from '../data/wakfu-item-rarity.data';

export interface RecipeTrackingIngredient {
  name: string;
  /** Quantité de cet ingrédient nécessaire pour UNE unité de l'objet parent (source ou, en
   * imbrication, ingrédient parent). */
  quantity: number;
  /** Vrai si cet ingrédient a lui-même une recette connue et résolue (voir RecipeQuantityModalComponent,
   * icône "imbriquer les ingrédients de cet objet") — le collapse est disponible en cascade sur
   * autant de niveaux que \`recipeIngredients\` en comporte. */
  hasRecipe: boolean;
  /** Ingrédients de la recette de CET ingrédient, résolus récursivement — vide si `hasRecipe` est faux. */
  recipeIngredients: readonly RecipeTrackingIngredient[];
}

export interface RecipeTrackingRequest {
  /** Nom FR canonique de l'objet source — clé pour son icône (voir app-item-icon). */
  itemName: string;
  /** Nom affiché (langue courante) de l'objet source dont on veut suivre les ingrédients. */
  itemLabel: string;
  /** Rareté de l'objet source — pilote le dégradé de fond du bandeau (voir RecipeQuantityModalComponent). */
  itemRarity: WakfuRarity;
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
