import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { RecipeTrackingService } from '../../core/services/recipe-tracking.service';
import { StatsStoreService } from '../../core/services/stats-store.service';
import { TranslatePipe } from '../translate.pipe';
import { ItemIconComponent } from '../item-icon/item-icon.component';
import { resolveNumericKeyAction } from '../../core/utils/numeric-keydown.util';

/**
 * Modale "suivre les objets de la recette" (voir RecipeTrackingService, ouverte depuis l'icône
 * recette de WakfuAutocompleteComponent) — rendue une seule fois au niveau racine (voir
 * app.html), même principe que HelpModalComponent/ClassPickerComponent. Saisie d'une quantité
 * (multiplicateur, min 1, comportement identique à l'input décompte des KPI — voir
 * resolveNumericKeyAction) puis validation (bouton ou Entrée) : crée ou met à jour un KPI en
 * mode décompte pour chaque ingrédient de la recette, valeur = quantité recette × multiplicateur.
 */
@Component({
  selector: 'app-recipe-quantity-modal',
  imports: [TranslatePipe, ItemIconComponent],
  templateUrl: './recipe-quantity-modal.component.html',
  styleUrl: './recipe-quantity-modal.component.css',
})
export class RecipeQuantityModalComponent {
  protected readonly recipeTracking = inject(RecipeTrackingService);
  private readonly stats = inject(StatsStoreService);

  protected readonly quantity = signal(1);
  private readonly quantityInput = viewChild<ElementRef<HTMLInputElement>>('quantityInput');

  /** Noms des ingrédients actuellement imbriqués (collapse ouvert, voir toggleNested) — un
   * ingrédient imbriqué n'est lui-même plus suivi à la validation, seuls ses propres ingrédients
   * le sont (voir confirm()). */
  private readonly nestedIngredients = signal<ReadonlySet<string>>(new Set());

  /** Aperçu des quantités réellement appliquées à chaque ingrédient si l'utilisateur valide
   * maintenant, avec le détail des sous-ingrédients pour toute ligne actuellement imbriquée. */
  protected readonly preview = computed(() => {
    const req = this.recipeTracking.request();
    const multiplier = this.quantity();
    const nested = this.nestedIngredients();
    if (!req) return [];
    return req.ingredients.map((ing) => {
      const target = ing.quantity * multiplier;
      const isNested = ing.hasRecipe && nested.has(ing.name);
      return {
        name: ing.name,
        target,
        hasRecipe: ing.hasRecipe,
        nested: isNested,
        subIngredients: isNested
          ? ing.recipeIngredients.map((sub) => ({ name: sub.name, target: sub.quantity * target }))
          : [],
      };
    });
  });

  constructor() {
    effect(() => {
      if (this.recipeTracking.request()) {
        this.quantity.set(1);
        this.nestedIngredients.set(new Set());
        queueMicrotask(() => this.quantityInput()?.nativeElement.focus());
      }
    });
  }

  /** Bascule l'imbrication d'une ligne d'ingrédient (collapse ouvert <-> ligne standard) —
   * ignoré si l'ingrédient n'a pas de recette (icône masquée dans ce cas, voir template). */
  protected toggleNested(name: string, hasRecipe: boolean): void {
    if (!hasRecipe) return;
    this.nestedIngredients.update((set) => {
      const next = new Set(set);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    const action = resolveNumericKeyAction(event);
    if (action === 'block') {
      event.preventDefault();
    } else if (action === 'increment') {
      event.preventDefault();
      this.quantity.update((v) => v + 1);
    } else if (action === 'decrement') {
      event.preventDefault();
      this.quantity.update((v) => Math.max(1, v - 1));
    }
  }

  protected onInput(event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    this.quantity.set(Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1);
  }

  protected confirm(): void {
    const req = this.recipeTracking.request();
    if (!req) return;
    const multiplier = this.quantity();
    const nested = this.nestedIngredients();

    /** Cible cumulée par nom d'objet final : un même objet peut apparaître à la fois comme
     * ingrédient direct et comme sous-ingrédient d'une ligne imbriquée (ou dans plusieurs lignes
     * imbriquées) — les quantités doivent alors s'additionner plutôt que s'écraser. */
    const targets = new Map<string, number>();
    const addTarget = (name: string, amount: number): void => {
      targets.set(name, (targets.get(name) ?? 0) + amount);
    };

    for (const ingredient of req.ingredients) {
      const target = ingredient.quantity * multiplier;
      if (ingredient.hasRecipe && nested.has(ingredient.name)) {
        for (const sub of ingredient.recipeIngredients) {
          addTarget(sub.name, sub.quantity * target);
        }
      } else {
        addTarget(ingredient.name, target);
      }
    }

    for (const [name, target] of targets) {
      this.stats.addWatchedItem(name);
      this.stats.setWatchlistMode(name, 'down');
      this.stats.setWatchlistCountdownTarget(name, target);
    }
    this.recipeTracking.close();
  }

  protected close(): void {
    this.recipeTracking.close();
  }
}
