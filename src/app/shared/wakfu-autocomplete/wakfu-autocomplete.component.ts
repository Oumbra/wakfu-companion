import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
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

export type WakfuAutocompleteDomain = 'item' | 'enemy' | 'both';

export interface WakfuAutocompleteExisting {
  name: string;
  kind: WakfuSearchKind;
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
  imports: [ItemIconComponent, EntityIconComponent],
  templateUrl: './wakfu-autocomplete.component.html',
  styleUrl: './wakfu-autocomplete.component.css',
})
export class WakfuAutocompleteComponent {
  readonly domain = input.required<WakfuAutocompleteDomain>();
  readonly placeholder = input('');
  /** Entrées déjà présentes dans la liste cible : marquées non sélectionnables dans les suggestions. */
  readonly existingNames = input<readonly WakfuAutocompleteExisting[]>([]);

  readonly selected = output<WakfuSearchResult>();

  private readonly search = inject(WakfuSearchService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly activeIndex = signal(0);

  private readonly itemButtons = viewChildren<ElementRef<HTMLButtonElement>>('itemButton');

  private readonly existingSet = computed(
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
    const existing = this.existingSet();
    return raw.map((r) => ({
      ...r,
      disabled: existing.has(`${r.kind}:${normalizeWakfuName(r.name)}`),
    }));
  });

  constructor() {
    const onDocumentClick = (event: MouseEvent): void => {
      if (!this.elementRef.nativeElement.contains(event.target as Node)) {
        this.open.set(false);
      }
    };
    document.addEventListener('click', onDocumentClick);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('click', onDocumentClick));
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.activeIndex.set(0);
    this.open.set(true);
  }

  protected onFocus(): void {
    this.open.set(true);
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
}
