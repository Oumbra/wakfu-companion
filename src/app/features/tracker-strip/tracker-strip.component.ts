import { Component, computed, ElementRef, inject, signal } from '@angular/core';
import { StatsStoreService, WatchlistEntry } from '../../core/services/stats-store.service';
import { EntityIconComponent } from '../../shared/entity-icon/entity-icon.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { WakfuAutocompleteComponent } from '../../shared/wakfu-autocomplete/wakfu-autocomplete.component';
import { WakfuSearchResult } from '../../core/services/wakfu-search.service';
import { getWakfuItemRarity } from '../../core/data/wakfu-item-rarity.data';

/**
 * Suivi (desktop) : bande horizontale de KPI compacts au-dessus de la ligne
 * de panneaux (voir dashboard.component.html), sans fond ni bordure propres
 * — chaque tuile se déploie au survol pour révéler nom + reset. Masqué en
 * dessous du breakpoint mobile (voir CSS) : le mobile garde Suivi comme un
 * onglet à part entière, affiché par TrackerComponent (grille de cartes).
 */
@Component({
  selector: 'app-tracker-strip',
  imports: [NumberFrPipe, EntityIconComponent, ItemIconComponent, TranslatePipe, WakfuAutocompleteComponent],
  templateUrl: './tracker-strip.component.html',
  styleUrl: './tracker-strip.component.css',
})
export class TrackerStripComponent {
  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  protected readonly existingNames = computed(() =>
    this.stats.watchlist().map((w) => ({ name: w.name, kind: w.kind })),
  );

  protected readonly addOpen = signal(false);
  /** Nom de l'entrée dont la popover de confirmation de suppression est actuellement ouverte (une seule à la fois). */
  protected readonly confirmDeleteName = signal<string | null>(null);
  /** Position (right/bottom, relative au host) de la popover ouverte — calculée en JS plutôt
   * qu'ancrée en CSS pur sur la tuile : `.kpi-strip` a `overflow-y:hidden` (scroll horizontal
   * seul, voir CLAUDE.md/consigne desktop), qui rognerait sinon la popover positionnée
   * au-dessus d'une tuile de la rangée (même piège que les tooltips de première ligne, en pire
   * — ici c'est un vrai clip d'overflow, pas juste un recouvrement visuel). Ancrer au host
   * (`:host{position:relative}`, aucun overflow) plutôt qu'à `.kpi-strip` contourne le clip. */
  protected readonly confirmPopoverPos = signal<{ right: number; bottom: number } | null>(null);
  /** Voir tracker.component.ts : mêmes règles de détection de troncature. */
  private readonly truncatedNames = signal<ReadonlySet<string>>(new Set());

  protected rarityClass(entry: WatchlistEntry): string {
    return entry.kind === 'item' ? `rarity-${getWakfuItemRarity(entry.name)}` : '';
  }

  protected displayName(entry: WatchlistEntry): string {
    return entry.kind === 'item'
      ? this.i18n.translateItemName(entry.name)
      : this.i18n.translateMonsterName(entry.name);
  }

  protected isTruncated(name: string): boolean {
    return this.truncatedNames().has(name);
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
    if (result.kind === 'enemy') this.stats.addWatchedEnemy(result.name);
    else this.stats.addWatchedItem(result.name);
    this.addOpen.set(false);
  }

  protected resetCount(name: string): void {
    this.stats.resetWatchedCount(name);
  }

  protected requestDelete(event: Event, name: string): void {
    event.stopPropagation();
    const tile = (event.currentTarget as HTMLElement).closest('.kpi') as HTMLElement;
    const hostRect = this.elementRef.nativeElement.getBoundingClientRect();
    const tileRect = tile.getBoundingClientRect();
    this.confirmPopoverPos.set({
      right: hostRect.right - tileRect.right - 8,
      bottom: hostRect.bottom - tileRect.top + 8,
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

  private dragIndex: number | null = null;

  protected onDragStart(index: number, event: DragEvent): void {
    this.dragIndex = index;
    const tile = event.currentTarget as HTMLElement;
    event.dataTransfer?.setDragImage(tile, event.offsetX, event.offsetY);
  }

  protected onDrop(index: number): void {
    if (this.dragIndex !== null && this.dragIndex !== index) {
      this.stats.reorderWatchlist(this.dragIndex, index);
    }
    this.dragIndex = null;
  }
}
