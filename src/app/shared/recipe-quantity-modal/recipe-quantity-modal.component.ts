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

  /** Aperçu des quantités réellement appliquées à chaque ingrédient si l'utilisateur valide maintenant. */
  protected readonly preview = computed(() => {
    const req = this.recipeTracking.request();
    const multiplier = this.quantity();
    if (!req) return [];
    return req.ingredients.map((ing) => ({ name: ing.name, target: ing.quantity * multiplier }));
  });

  constructor() {
    effect(() => {
      if (this.recipeTracking.request()) {
        this.quantity.set(1);
        queueMicrotask(() => this.quantityInput()?.nativeElement.focus());
      }
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
    for (const ingredient of req.ingredients) {
      this.stats.addWatchedItem(ingredient.name);
      this.stats.setWatchlistMode(ingredient.name, 'down');
      this.stats.setWatchlistCountdownTarget(ingredient.name, ingredient.quantity * multiplier);
    }
    this.recipeTracking.close();
  }

  protected close(): void {
    this.recipeTracking.close();
  }
}
