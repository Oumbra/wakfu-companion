import { Component, computed, inject } from '@angular/core';
import { StatsStoreService } from '../../core/services/stats-store.service';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { EntityIconComponent } from '../../shared/entity-icon/entity-icon.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { KoIconComponent } from '../../shared/ko-icon/ko-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { WakfuAutocompleteComponent } from '../../shared/wakfu-autocomplete/wakfu-autocomplete.component';
import { WakfuSearchResult } from '../../core/services/wakfu-search.service';

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
  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);

  protected readonly existingNames = computed(() =>
    this.stats.watchlist().map((w) => ({ name: w.name, kind: w.kind })),
  );

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

  protected onDragStart(index: number): void {
    this.dragIndex = index;
  }

  protected onDrop(index: number): void {
    if (this.dragIndex !== null && this.dragIndex !== index) {
      this.stats.reorderWatchlist(this.dragIndex, index);
    }
    this.dragIndex = null;
  }
}
