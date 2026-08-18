import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WakfuAutocompleteComponent,
  WakfuAutocompleteOption,
} from './wakfu-autocomplete.component';
import { CatalogService } from '../../core/api/catalog.service';
import { RecipeTrackingService } from '../../core/services/recipe-tracking.service';

/** Entrée de suggestion minimale, id résolu (seul cas qui déclenche réellement `openRecipe`, voir
 * son garde `entry.id === null`). */
const fakeEntry: WakfuAutocompleteOption = {
  id: 1,
  name: 'Objet test',
  label: 'Objet test',
  kind: 'item',
  hasRecipe: true,
  rarity: null,
  category: null,
  disabled: false,
};

describe('WakfuAutocompleteComponent — ouverture de la modale recette pendant la résolution', () => {
  let component: WakfuAutocompleteComponent;
  let recipeTracking: RecipeTrackingService;
  let catalog: CatalogService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [WakfuAutocompleteComponent] });
    const fixture = TestBed.createComponent(WakfuAutocompleteComponent);
    fixture.componentRef.setInput('domain', 'item');
    fixture.detectChanges();
    component = fixture.componentInstance;
    recipeTracking = TestBed.inject(RecipeTrackingService);
    catalog = TestBed.inject(CatalogService);
  });

  it('ouvre la modale immédiatement (ingredients: null) puis la complète une fois la résolution réseau terminée', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolveFn!: (ingredients: any[]) => void;
    vi.spyOn(catalog, 'resolveRecipeIngredients').mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );

    expect(recipeTracking.request()).toBeNull();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openPromise = (component as any).openRecipe(
      new MouseEvent('click'),
      fakeEntry,
    ) as Promise<void>;

    await Promise.resolve();
    await Promise.resolve();
    expect(recipeTracking.request()).not.toBeNull();
    expect(recipeTracking.request()?.ingredients).toBeNull();

    const ingredients = [
      {
        name: 'Ingr',
        id: 2,
        rarity: 'common',
        quantity: 1,
        hasRecipe: false,
        recipeIngredients: [],
      },
    ];
    resolveFn(ingredients);
    await openPromise;

    expect(recipeTracking.request()?.ingredients).toEqual(ingredients);
  });

  it("referme la modale sans avoir affiché de liste si la recette résolue n'a aucun ingrédient", async () => {
    vi.spyOn(catalog, 'resolveRecipeIngredients').mockResolvedValue([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (component as any).openRecipe(new MouseEvent('click'), fakeEntry);

    expect(recipeTracking.request()).toBeNull();
  });

  it('referme la modale si la résolution réseau échoue', async () => {
    let rejectFn!: (err: unknown) => void;
    vi.spyOn(catalog, 'resolveRecipeIngredients').mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectFn = reject;
      }),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openPromise = (component as any).openRecipe(
      new MouseEvent('click'),
      fakeEntry,
    ) as Promise<void>;
    await Promise.resolve();
    await Promise.resolve();
    expect(recipeTracking.request()).not.toBeNull();

    rejectFn(new Error('réseau indisponible'));
    await expect(openPromise).rejects.toThrow();

    expect(recipeTracking.request()).toBeNull();
  });
});
