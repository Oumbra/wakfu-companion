import { Component, inject, signal } from '@angular/core';
import { StatsStoreService, WatchlistKind } from '../../core/services/stats-store.service';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { EntityIconComponent } from '../../shared/entity-icon/entity-icon.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { KoIconComponent } from '../../shared/ko-icon/ko-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';

@Component({
  selector: 'app-tracker',
  imports: [NumberFrPipe, EntityIconComponent, ItemIconComponent, KoIconComponent, TranslatePipe],
  templateUrl: './tracker.component.html',
  styleUrl: './tracker.component.css',
})
export class TrackerComponent {
  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);

  protected readonly newName = signal('');
  protected readonly newKind = signal<WatchlistKind>('enemy');

  protected setNewName(value: string): void {
    this.newName.set(value);
  }

  protected setNewKind(kind: WatchlistKind): void {
    this.newKind.set(kind);
  }

  protected add(): void {
    if (this.newKind() === 'enemy') {
      this.stats.addWatchedEnemy(this.newName());
    } else {
      this.stats.addWatchedItem(this.newName());
    }
    this.newName.set('');
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
