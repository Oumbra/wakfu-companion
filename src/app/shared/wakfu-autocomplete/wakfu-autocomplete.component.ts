import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import {
  WakfuSearchKind,
  WakfuSearchResult,
  WakfuSearchService,
} from '../../core/services/wakfu-search.service';
import { ItemIconComponent } from '../item-icon/item-icon.component';
import { EntityIconComponent } from '../entity-icon/entity-icon.component';
import { normalizeWakfuName } from '../../core/utils/wakfu-name.util';
import { CatalogService } from '../../core/api/catalog.service';
import { wakfuRarityIconUrl } from '../../core/data/wakfu-item-rarity.data';
import { RECIPE_ICON_DATA_URI } from '../../core/data/recipe-icon.data';
import { RecipeTrackingService } from '../../core/services/recipe-tracking.service';
import { TranslatePipe } from '../translate.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';

export type WakfuAutocompleteDomain = 'item' | 'enemy' | 'both';

export interface WakfuAutocompleteExisting {
  name: string;
  kind: WakfuSearchKind;
  /** Id Ankama déjà résolu pour cette entrée existante, `null` si jamais résolu (voir
   * WatchlistEntry.catalogId/SoundItemEntry.catalogId) — permet de ne désactiver, dans la liste
   * de suggestions, que la suggestion correspondant EXACTEMENT à cette entrée (même id), pas
   * toute suggestion homonyme (voir `results`, deux objets/monstres peuvent partager un nom, ex.
   * "Larme d'Ogrest"). */
  id: number | null;
}

export interface WakfuAutocompleteOption extends WakfuSearchResult {
  /** Déjà présent dans la liste cible (suivi, alertes) : affiché grisé, non sélectionnable. */
  disabled: boolean;
}

/**
 * Champ de saisie avec autocomplétion sur le référentiel objets/monstres
 * (voir WakfuSearchService) : se déclenche à partir de 3 caractères,
 * affiche les résultats triés par ordre alphabétique sous la forme icône +
 * nom, dans la langue actuelle de l'utilisateur — la liste défile au-delà de
 * 5 éléments (voir `.wakfu-autocomplete-list` en CSS) plutôt que de tronquer
 * les résultats. Aucune saisie libre n'est acceptée — seule la sélection
 * d'une suggestion non déjà présente (voir `existingNames`) émet `selected`
 * (le champ se vide ensuite, prêt pour un nouvel ajout). En domaine `both`,
 * chaque suggestion identifie elle-même son type (`kind`, objet ou monstre)
 * via le référentiel qui l'a produite — pas besoin d'un sélecteur manuel
 * préalable.
 */
@Component({
  selector: 'app-wakfu-autocomplete',
  imports: [ItemIconComponent, EntityIconComponent, TranslatePipe, TooltipDirective],
  templateUrl: './wakfu-autocomplete.component.html',
  styleUrl: './wakfu-autocomplete.component.css',
})
export class WakfuAutocompleteComponent {
  readonly domain = input.required<WakfuAutocompleteDomain>();
  readonly placeholder = input('');
  /** Entrées déjà présentes dans la liste cible : marquées non sélectionnables dans les suggestions. */
  readonly existingNames = input<readonly WakfuAutocompleteExisting[]>([]);
  /** Icône "suivre les objets de la recette" (voir `openRecipe`) : visible par défaut, à
   * désactiver explicitement là où l'ajout ne concerne pas le suivi principal (ex. sélecteur
   * d'objets pour les alertes sonores de la page profil) — seul le suivi (tracker/tracker-strip)
   * a vocation à ouvrir la modale de recette depuis cette liste. */
  readonly showRecipeButton = input(true);
  /** Dépouille le champ de son fond/bordure propres (voir wakfu-autocomplete.component.css) —
   * pour un appelant qui pose déjà son propre habillage autour (ex. `.sound-item-add` en page
   * profil, cadre pointillé façon zone de dépôt) et ne veut pas d'un double encadrement. */
  readonly bare = input(false);

  readonly selected = output<WakfuSearchResult>();
  /** Émis quand une modale recette ouverte depuis CETTE instance (voir `openRecipe`) vient d'être
   * validée (voir RecipeTrackingService.confirm()) — permet à un parent doté d'un formulaire
   * d'ajout repliable (voir tracker-strip.component.ts) de se refermer, comme si l'utilisateur
   * avait cliqué sur "Fermer" ; une fermeture sans validation (× de la modale, clic sur le fond)
   * n'émet volontairement rien. */
  readonly recipeConfirmed = output<void>();

  protected readonly recipeIcon = RECIPE_ICON_DATA_URI;
  protected readonly rarityIconUrl = wakfuRarityIconUrl;

  private readonly search = inject(WakfuSearchService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly recipeTracking = inject(RecipeTrackingService);
  private readonly catalog = inject(CatalogService);

  readonly focused = signal(false);
  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly activeIndex = signal(0);
  /** Vrai pendant la résolution récursive (réseau, voir CatalogService.resolveRecipeIngredients)
   * d'une recette ouverte depuis CETTE instance — désactive les boutons recette le temps de
   * l'appel pour éviter une double ouverture concurrente. */
  protected readonly recipeLoading = signal(false);

  private readonly itemButtons = viewChildren<ElementRef<HTMLButtonElement>>('itemButton');
  private readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('inputEl');

  /** Donne le focus au champ de saisie — appelé par le parent juste après
   * l'ouverture d'un formulaire d'ajout (voir tracker-strip.component.ts). */
  focus(): void {
    this.inputEl()?.nativeElement.focus();
  }

  /**
   * Trois ensembles pour désactiver une suggestion sans confondre deux objets/monstres
   * homonymes d'id différent (ex. les deux "Larme d'Ogrest") :
   * - `existingByKindId` : entrées déjà suivies dont l'id est connu — une suggestion partageant
   *   ce même id précis est désactivée, mais PAS une suggestion homonyme d'id différent.
   * - `existingByKindNameUnresolved` : entrées déjà suivies dont l'id n'est PAS connu (legacy,
   *   voir StatsStoreService.normalizeWatchlistEntry) — par prudence, toute suggestion de même
   *   nom reste désactivée tant qu'on ne peut pas garantir qu'il s'agit d'un objet différent.
   * - `existingByKindNameAny` : n'entre en jeu que pour une suggestion dont l'id est lui-même
   *   inconnu (`r.id === null`, rare — objets historiques sans id Ankama) : dans ce cas
   *   impossible de la distinguer d'une entrée déjà suivie, id connu ou non, donc repli complet
   *   sur le nom, comme avant l'introduction de l'id.
   */
  private readonly existingByKindId = computed(
    () =>
      new Set(
        this.existingNames()
          .filter((e) => e.id !== null)
          .map((e) => `${e.kind}:${e.id}`),
      ),
  );
  private readonly existingByKindNameUnresolved = computed(
    () =>
      new Set(
        this.existingNames()
          .filter((e) => e.id === null)
          .map((e) => `${e.kind}:${normalizeWakfuName(e.name)}`),
      ),
  );
  private readonly existingByKindNameAny = computed(
    () => new Set(this.existingNames().map((e) => `${e.kind}:${normalizeWakfuName(e.name)}`)),
  );

  protected readonly results = computed<WakfuAutocompleteOption[]>(() => {
    const q = this.query();
    const domain = this.domain();
    const raw =
      domain === 'item'
        ? this.search.searchItems(q)
        : domain === 'enemy'
          ? this.search.searchEnemies(q)
          : this.search.searchAll(q);
    const byId = this.existingByKindId();
    const byNameUnresolved = this.existingByKindNameUnresolved();
    const byNameAny = this.existingByKindNameAny();
    return raw.map((r) => {
      const disabled =
        r.id !== null
          ? byId.has(`${r.kind}:${r.id}`) ||
            byNameUnresolved.has(`${r.kind}:${normalizeWakfuName(r.name)}`)
          : byNameAny.has(`${r.kind}:${normalizeWakfuName(r.name)}`);
      return { ...r, disabled };
    });
  });

  /** Vrai tant qu'une recette ouverte par CETTE instance (voir `openRecipe`) est en attente —
   * distingue, dans l'effect ci-dessous, une validation qui nous concerne d'une validation
   * déclenchée par une autre instance d'autocomplétion (ex. tracker mobile vs tracker-strip
   * desktop, tous deux montés simultanément, voir app.html). Effacé aussi bien par une validation
   * que par une simple fermeture (× de la modale), pour ne pas faire passer une validation
   * ultérieure déclenchée ailleurs pour la nôtre. */
  private awaitingOwnRecipeConfirm = false;

  constructor() {
    const onDocumentClick = (event: MouseEvent): void => {
      if (!this.elementRef.nativeElement.contains(event.target as Node)) {
        this.open.set(false);
      }
    };
    document.addEventListener('click', onDocumentClick);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('click', onDocumentClick));

    let lastConfirmedAt: number | null = null;
    effect(() => {
      const confirmedAt = this.recipeTracking.confirmedAt();
      const requestClosed = this.recipeTracking.request() === null;
      const didConfirm = lastConfirmedAt !== null && confirmedAt !== lastConfirmedAt;
      lastConfirmedAt = confirmedAt;
      if (!requestClosed || !this.awaitingOwnRecipeConfirm) return;
      this.awaitingOwnRecipeConfirm = false;
      if (didConfirm) this.recipeConfirmed.emit();
    });
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.activeIndex.set(0);
    this.open.set(true);
  }

  protected onFocus(): void {
    this.open.set(true);
    this.focused.set(true);
  }

  protected onBlur(): void {
    this.focused.set(false);
  }

  protected moveActive(delta: number): void {
    const list = this.results();
    if (list.length === 0) return;
    let index = this.activeIndex();
    for (let i = 0; i < list.length; i++) {
      index = (index + delta + list.length) % list.length;
      if (!list[index].disabled) break;
    }
    this.activeIndex.set(index);
    this.itemButtons()[index]?.nativeElement.scrollIntoView({ block: 'nearest' });
  }

  protected selectActive(): void {
    const entry = this.results()[this.activeIndex()];
    if (entry && !entry.disabled) this.select(entry);
  }

  protected select(entry: WakfuAutocompleteOption): void {
    if (entry.disabled) return;
    this.selected.emit(entry);
    this.query.set('');
    this.open.set(false);
    this.activeIndex.set(0);
  }

  protected close(): void {
    this.open.set(false);
  }

  /** Ouvre la modale "suivre les objets de la recette" (voir RecipeTrackingService) — indépendant
   * de `select()` : ne doit jamais ajouter `entry` lui-même au suivi. ASYNCHRONE (lot 3.1, étape 5)
   * : la résolution récursive de la recette nécessite désormais un aller-retour réseau par niveau
   * (voir CatalogService.resolveRecipeIngredients) — `recipeLoading` pilote l'état de chargement
   * pendant l'appel (voir template, boutons recette désactivés). */
  protected async openRecipe(event: Event, entry: WakfuAutocompleteOption): Promise<void> {
    event.stopPropagation();
    if (entry.id === null || this.recipeLoading()) return;
    this.recipeLoading.set(true);
    try {
      const ingredients = await this.catalog.resolveRecipeIngredients(entry.id);
      if (ingredients.length === 0) return;
      this.awaitingOwnRecipeConfirm = true;
      this.recipeTracking.open({
        itemName: entry.name,
        itemLabel: entry.label,
        itemRarity: entry.rarity ?? 'common',
        ingredients,
      });
    } finally {
      this.recipeLoading.set(false);
    }
  }
}
