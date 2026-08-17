import { Injectable, signal } from '@angular/core';
import { WakfuRarity } from '../data/wakfu-item-rarity.data';

export interface RecipeTrackingIngredient {
  name: string;
  /** Id Ankama EXACT de cet ingrédient — voir CatalogResolvedIngredient.id : à transmettre au
   * suivi (StatsStoreService.addWatchedItem) plutôt que de laisser une résolution par nom seul
   * retomber sur une variante de rareté différente du même nom (voir tracker.recipeConfirm). */
  id: number;
  /** Rareté de cet ingrédient — pilote le dégradé de fond de sa ligne (voir
   * RecipeQuantityModalComponent), même principe que `itemRarity` sur l'objet source. */
  rarity: WakfuRarity;
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
  /** `null` tant que la résolution réseau des ingrédients (voir CatalogService.resolveRecipeIngredients)
   * est en cours — la modale affiche alors un spinner à la place (voir RecipeQuantityModalComponent)
   * plutôt que de bloquer l'app entière derrière l'overlay plein écran (voir `open()`/`setIngredients()`). */
  ingredients: readonly RecipeTrackingIngredient[] | null;
}

/**
 * Pilote la modale "suivre les objets de la recette" (voir RecipeQuantityModalComponent, rendue
 * une seule fois au niveau racine — même principe que HelpModalService/ClassPickerService) :
 * ouverte depuis l'icône recette de WakfuAutocompleteComponent sur un objet `hasRecipe`.
 */
@Injectable({ providedIn: 'root' })
export class RecipeTrackingService {
  readonly request = signal<RecipeTrackingRequest | null>(null);

  /** Incrémenté à chaque validation réussie de la modale (voir `confirm()`) — permet à
   * WakfuAutocompleteComponent de réagir spécifiquement à une validation (pour réinitialiser le
   * formulaire d'ajout au suivi qui l'a ouverte, voir `recipeConfirmed`), par opposition à une
   * simple fermeture (bouton ×, clic sur le fond, voir `close()`) qui ne doit rien réinitialiser. */
  readonly confirmedAt = signal(0);

  /** Ouvre la modale — appelé dès le clic sur l'icône recette, AVANT la résolution réseau des
   * ingrédients (voir WakfuAutocompleteComponent.openRecipe) : `request.ingredients` vaut `null`
   * le temps de cet appel, `setIngredients()` le complète ensuite sans refermer/rouvrir la modale. */
  open(request: RecipeTrackingRequest): void {
    this.request.set(request);
  }

  /** Complète la requête en cours avec les ingrédients résolus (voir `open()`) — no-op si la
   * modale a été refermée entre-temps (ex. × cliqué pendant la résolution réseau). */
  setIngredients(ingredients: readonly RecipeTrackingIngredient[]): void {
    this.request.update((req) => (req ? { ...req, ingredients } : req));
  }

  /** Ferme la modale sans validation (bouton ×, clic sur le fond) — voir `confirm()` pour la
   * fermeture suite à une validation réussie. */
  close(): void {
    this.request.set(null);
  }

  /** Ferme la modale suite à une validation réussie (voir RecipeQuantityModalComponent.confirm()). */
  confirm(): void {
    this.confirmedAt.update((v) => v + 1);
    this.request.set(null);
  }
}
