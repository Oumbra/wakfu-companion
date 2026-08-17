import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WakfuAutocompleteComponent, WakfuAutocompleteOption } from './wakfu-autocomplete.component';
import { CatalogService } from '../../core/api/catalog.service';
import { LoadingOverlayService } from '../../core/services/loading-overlay.service';

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

describe('WakfuAutocompleteComponent — overlay de chargement pendant la résolution de recette', () => {
  let component: WakfuAutocompleteComponent;
  let loadingOverlay: LoadingOverlayService;
  let catalog: CatalogService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [WakfuAutocompleteComponent] });
    const fixture = TestBed.createComponent(WakfuAutocompleteComponent);
    fixture.componentRef.setInput('domain', 'item');
    fixture.detectChanges();
    component = fixture.componentInstance;
    loadingOverlay = TestBed.inject(LoadingOverlayService);
    catalog = TestBed.inject(CatalogService);
  });

  it("affiche l'overlay pendant l'appel réseau puis le masque, succès comme échec", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolveFn!: (ingredients: any[]) => void;
    vi.spyOn(catalog, 'resolveRecipeIngredients').mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );

    expect(loadingOverlay.visible()).toBe(false);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openPromise = (component as any).openRecipe(new MouseEvent('click'), fakeEntry) as Promise<void>;

    await Promise.resolve();
    await Promise.resolve();
    expect(loadingOverlay.visible()).toBe(true);

    resolveFn([]);
    await openPromise;

    expect(loadingOverlay.visible()).toBe(false);
  });

  it("masque aussi l'overlay si la résolution réseau échoue", async () => {
    let rejectFn!: (err: unknown) => void;
    vi.spyOn(catalog, 'resolveRecipeIngredients').mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectFn = reject;
      }),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openPromise = (component as any).openRecipe(new MouseEvent('click'), fakeEntry) as Promise<void>;
    await Promise.resolve();
    await Promise.resolve();
    expect(loadingOverlay.visible()).toBe(true);

    rejectFn(new Error('réseau indisponible'));
    await expect(openPromise).rejects.toThrow();

    expect(loadingOverlay.visible()).toBe(false);
  });
});
