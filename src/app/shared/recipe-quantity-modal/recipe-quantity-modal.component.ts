import { Component, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  RecipeTrackingIngredient,
  RecipeTrackingService,
} from '../../core/services/recipe-tracking.service';
import { StatsStoreService } from '../../core/services/stats-store.service';
import { TranslatePipe } from '../translate.pipe';
import { ItemIconComponent } from '../item-icon/item-icon.component';
import { resolveNumericKeyAction } from '../../core/utils/numeric-keydown.util';
import { TooltipDirective } from '../tooltip/tooltip.directive';

/**
 * Modale "suivre les objets de la recette" (voir RecipeTrackingService, ouverte depuis l'icône
 * recette de WakfuAutocompleteComponent) — rendue une seule fois au niveau racine (voir
 * app.html), même principe que HelpModalComponent/ClassPickerComponent. Saisie d'une quantité
 * (multiplicateur, min 1, comportement identique à l'input décompte des KPI — voir
 * resolveNumericKeyAction) puis validation (bouton ou Entrée) : crée ou met à jour un KPI en
 * mode décompte pour chaque ingrédient de la recette, valeur = quantité recette × multiplicateur.
 *
 * Un ingrédient ayant lui-même une recette peut être "imbriqué" (voir toggleNested/nestedPaths) :
 * sa ligne devient un collapse listant SES propres ingrédients, en cascade sur autant de niveaux
 * que la recette en comporte (rendu récursif via le template \`#ingredientRow\`, voir le HTML).
 * Chaque ligne est identifiée par un chemin d'index stable ("0", "0.2", "0.2.1"...) plutôt que par
 * son nom, pour distinguer 2 occurrences homonymes à des positions différentes de l'arbre.
 */
@Component({
  selector: 'app-recipe-quantity-modal',
  imports: [TranslatePipe, ItemIconComponent, NgTemplateOutlet, TooltipDirective],
  templateUrl: './recipe-quantity-modal.component.html',
  styleUrl: './recipe-quantity-modal.component.css',
})
export class RecipeQuantityModalComponent {
  protected readonly recipeTracking = inject(RecipeTrackingService);
  private readonly stats = inject(StatsStoreService);

  protected readonly quantity = signal(1);
  private readonly quantityInput = viewChild<ElementRef<HTMLInputElement>>('quantityInput');

  /** Chemins (voir doc de classe) des lignes actuellement imbriquées (collapse ouvert, voir
   * toggleNested) — un ingrédient imbriqué n'est lui-même plus suivi à la validation, seuls ses
   * propres ingrédients le sont (voir confirm()). */
  protected readonly nestedPaths = signal<ReadonlySet<string>>(new Set());

  constructor() {
    effect(() => {
      if (this.recipeTracking.request()) {
        this.quantity.set(1);
        this.nestedPaths.set(new Set());
        queueMicrotask(() => this.quantityInput()?.nativeElement.focus());
      }
    });
  }

  /** Bascule l'imbrication d'une ligne d'ingrédient (collapse ouvert <-> ligne standard) —
   * ignoré si l'ingrédient n'a pas de recette (icône masquée dans ce cas, voir template). */
  protected toggleNested(path: string, hasRecipe: boolean): void {
    if (!hasRecipe) return;
    this.nestedPaths.update((set) => {
      const next = new Set(set);
      if (next.has(path)) next.delete(path);
      else next.add(path);
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
    const nested = this.nestedPaths();

    /** Cible cumulée par ingrédient final, clé sur son id (voir RecipeTrackingIngredient.id) —
     * PAS sur son nom seul : un même nom peut désigner deux variantes de rareté différente du
     * même objet (ex. une recette qui redemande l'objet lui-même à un palier inférieur), qu'il
     * ne faut surtout pas fusionner sous une même cible. Un même objet (même id) peut en
     * revanche apparaître à la fois comme ingrédient direct et comme (sous-)ingrédient d'une ou
     * plusieurs lignes imbriquées à différents niveaux — dans ce cas les quantités s'additionnent. */
    const targets = new Map<number, { name: string; target: number }>();
    const addTarget = (name: string, id: number, amount: number): void => {
      const existing = targets.get(id);
      targets.set(id, { name, target: (existing?.target ?? 0) + amount });
    };

    /** Descend récursivement dans l'arbre tant qu'une ligne est imbriquée : seules les feuilles
     * (ingrédient non imbriqué, qu'il ait ou non une recette) contribuent au suivi final. */
    const walk = (
      ingredients: readonly RecipeTrackingIngredient[],
      parentMultiplier: number,
      parentPath: string,
    ): void => {
      ingredients.forEach((ingredient, index) => {
        const path = parentPath === '' ? `${index}` : `${parentPath}.${index}`;
        const target = ingredient.quantity * parentMultiplier;
        if (ingredient.hasRecipe && nested.has(path)) {
          walk(ingredient.recipeIngredients, target, path);
        } else {
          addTarget(ingredient.name, ingredient.id, target);
        }
      });
    };
    walk(req.ingredients, multiplier, '');

    for (const [id, { name, target }] of targets) {
      // Un objet déjà suivi en décompte (ex. confirmation d'une recette précédente qui le
      // redemandait déjà) cumule le nouveau besoin sur l'existant au lieu de repartir d'un
      // décompte plein — sans quoi valider une 2e recette écraserait la progression déjà faite
      // sur la 1re (bug réel signalé). Toute autre situation (pas encore suivi, ou suivi en
      // mode 'up') garde le comportement d'origine : (re)crée l'entrée en décompte plein.
      const existing = this.stats.findWatchedEntry(name, id);
      if (existing?.mode === 'down') {
        this.stats.increaseWatchlistCountdownTarget(name, target, id);
      } else {
        this.stats.addWatchedItem(name, id);
        this.stats.setWatchlistMode(name, 'down', id);
        this.stats.setWatchlistCountdownTarget(name, target, id);
      }
    }
    this.recipeTracking.confirm();
  }

  protected close(): void {
    this.recipeTracking.close();
  }
}
