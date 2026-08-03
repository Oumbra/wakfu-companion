import { Component, computed, ElementRef, inject, signal } from '@angular/core';
import {
  StatsStoreService,
  WatchlistCounterMode,
  WatchlistEntry,
} from '../../core/services/stats-store.service';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { EntityIconComponent } from '../../shared/entity-icon/entity-icon.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { WakfuAutocompleteComponent } from '../../shared/wakfu-autocomplete/wakfu-autocomplete.component';
import { WakfuSearchResult } from '../../core/services/wakfu-search.service';
import { getWakfuItemRarity } from '../../core/data/wakfu-item-rarity.data';
import { resolveNumericKeyAction } from '../../core/utils/numeric-keydown.util';

/**
 * Suivi (mobile) : grille de cartes en flex-wrap (voir CLAUDE.md, même
 * principe que `.sound-item-grid` de la page profil), affichée uniquement
 * en dessous du breakpoint mobile (voir CSS) — au-dessus, Suivi est une
 * bande persistante rendue par TrackerStripComponent, pas un onglet.
 */
@Component({
  selector: 'app-tracker',
  imports: [NumberFrPipe, EntityIconComponent, ItemIconComponent, TranslatePipe, WakfuAutocompleteComponent],
  templateUrl: './tracker.component.html',
  styleUrl: './tracker.component.css',
})
export class TrackerComponent {
  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  protected readonly existingNames = computed(() =>
    this.stats.watchlist().map((w) => ({ name: w.name, kind: w.kind })),
  );

  protected readonly confirmDeleteName = signal<string | null>(null);
  /** Voir tracker-strip.component.ts : position calculée en JS relativement au
   * host (`:host{position:relative}`, sans overflow) plutôt qu'ancrée en CSS
   * pur sur la carte — `.tool-panel`/`.panel-body` ont `overflow:hidden`/`auto`,
   * qui rogneraient sinon la popover d'une carte proche du haut de la grille. */
  protected readonly confirmPopoverPos = signal<{ right: number; bottom: number } | null>(null);

  /** Noms actuellement tronqués par l'ellipsis CSS (détecté au survol, voir
   * `checkTruncation`) : seuls ceux-là reçoivent un `title`, pour n'afficher
   * la tooltip que quand le nom complet n'est pas déjà visible. */
  protected readonly truncatedNames = signal<ReadonlySet<string>>(new Set());

  /** Mode choisi via le switch à côté de l'autocomplétion — appliqué au KPI créé par `add()` (voir
   * WatchlistCounterMode). Réinitialisé à 'up' après chaque ajout. */
  protected readonly addMode = signal<WatchlistCounterMode>('up');

  protected rarityClass(entry: WatchlistEntry): string {
    return entry.kind === 'item' ? `rarity-${getWakfuItemRarity(entry.name)}` : '';
  }

  protected displayName(entry: WatchlistEntry): string {
    return entry.kind === 'item'
      ? this.i18n.translateItemName(entry.name)
      : this.i18n.translateMonsterName(entry.name);
  }

  protected checkTruncation(el: HTMLElement, name: string): void {
    const isTruncated = el.scrollWidth > el.clientWidth;
    const current = this.truncatedNames();
    if (isTruncated === current.has(name)) return;
    const updated = new Set(current);
    if (isTruncated) updated.add(name);
    else updated.delete(name);
    this.truncatedNames.set(updated);
  }

  protected add(result: WakfuSearchResult): void {
    if (result.kind === 'enemy') {
      this.stats.addWatchedEnemy(result.name);
    } else {
      this.stats.addWatchedItem(result.name);
    }
    if (this.addMode() === 'down') this.stats.setWatchlistMode(result.name, 'down');
    this.addMode.set('up');
  }

  protected setAddMode(mode: WatchlistCounterMode): void {
    this.addMode.set(mode);
  }

  protected resetCount(name: string): void {
    this.stats.resetWatchedCount(name);
  }

  protected setMode(name: string, mode: WatchlistCounterMode): void {
    this.stats.setWatchlistMode(name, mode);
  }

  /** Édition directe de la valeur de départ du décompte (mode 'down') — voir `.kpi-card-countdown-input`. */
  protected onCountdownInput(event: Event, name: string): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.stats.setWatchlistCountdownTarget(name, value);
  }

  /** Restreint l'input aux chiffres et pilote la valeur via les flèches haut/bas — voir
   * resolveNumericKeyAction. */
  protected onCountdownKeydown(event: KeyboardEvent, entry: WatchlistEntry): void {
    const action = resolveNumericKeyAction(event);
    if (action === 'block') {
      event.preventDefault();
    } else if (action === 'increment') {
      event.preventDefault();
      this.stats.setWatchlistCountdownTarget(entry.name, entry.count + 1);
    } else if (action === 'decrement') {
      event.preventDefault();
      this.stats.setWatchlistCountdownTarget(entry.name, Math.max(0, entry.count - 1));
    }
  }

  protected requestDelete(event: Event, name: string): void {
    event.stopPropagation();
    const card = (event.currentTarget as HTMLElement).closest('.kpi-card') as HTMLElement;
    const hostRect = this.elementRef.nativeElement.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    this.confirmPopoverPos.set({
      right: hostRect.right - cardRect.right - 8,
      bottom: hostRect.bottom - cardRect.top + 8,
    });
    this.confirmDeleteName.set(name);
  }

  protected confirmDelete(event: Event, name: string): void {
    event.stopPropagation();
    this.stats.removeWatched(name);
    this.confirmDeleteName.set(null);
  }

  protected cancelDelete(event: Event): void {
    event.stopPropagation();
    this.confirmDeleteName.set(null);
  }
}
