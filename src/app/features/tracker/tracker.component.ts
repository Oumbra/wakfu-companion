import { Component, computed, inject, signal } from '@angular/core';
import { StatsStoreService, WatchlistEntry } from '../../core/services/stats-store.service';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { EntityIconComponent } from '../../shared/entity-icon/entity-icon.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { KoIconComponent } from '../../shared/ko-icon/ko-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { WakfuAutocompleteComponent } from '../../shared/wakfu-autocomplete/wakfu-autocomplete.component';
import { WakfuSearchResult } from '../../core/services/wakfu-search.service';
import { HEADER_ICON_SUIVI_DATA_URI } from '../../core/data/header-icons.data';

@Component({
  selector: 'app-tracker',
  imports: [
    NumberFrPipe,
    EntityIconComponent,
    ItemIconComponent,
    KoIconComponent,
    TranslatePipe,
    WakfuAutocompleteComponent,
  ],
  templateUrl: './tracker.component.html',
  styleUrl: './tracker.component.css',
})
export class TrackerComponent {
  protected readonly headerIcon = HEADER_ICON_SUIVI_DATA_URI;
  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);

  protected readonly existingNames = computed(() =>
    this.stats.watchlist().map((w) => ({ name: w.name, kind: w.kind })),
  );

  /** Noms actuellement tronqués par l'ellipsis CSS (détecté au survol, voir
   * `checkTruncation`) : seuls ceux-là reçoivent un `title`, pour n'afficher
   * la tooltip que quand le nom complet n'est pas déjà visible. */
  protected readonly truncatedNames = signal<ReadonlySet<string>>(new Set());

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
  }

  protected remove(name: string): void {
    this.stats.removeWatched(name);
  }

  protected resetCount(name: string): void {
    this.stats.resetWatchedCount(name);
  }

  private dragIndex: number | null = null;

  /** Sans `setDragImage` explicite, le fantôme de drag généré par le
   * navigateur peut inclure un peu de la ligne voisine (rendu flou/décalé
   * selon le navigateur) — on le cadre nous-mêmes exactement sur la ligne
   * concernée pour éviter cet effet de débordement. */
  protected onDragStart(index: number, event: DragEvent): void {
    this.dragIndex = index;
    const row = event.currentTarget as HTMLElement;
    event.dataTransfer?.setDragImage(row, event.offsetX, event.offsetY);
  }

  protected onDrop(index: number): void {
    if (this.dragIndex !== null && this.dragIndex !== index) {
      this.stats.reorderWatchlist(this.dragIndex, index);
    }
    this.dragIndex = null;
  }
}
