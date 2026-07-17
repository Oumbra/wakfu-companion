import { Component, inject, signal } from '@angular/core';
import { StatsStoreService } from '../../core/services/stats-store.service';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { EntityIconComponent } from '../../shared/entity-icon/entity-icon.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';

@Component({
  selector: 'app-tracker',
  imports: [NumberFrPipe, EntityIconComponent, ItemIconComponent, TranslatePipe],
  templateUrl: './tracker.component.html',
  styleUrl: './tracker.component.css',
})
export class TrackerComponent {
  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);

  protected readonly newEnemyName = signal('');
  protected readonly newItemName = signal('');

  protected setNewEnemyName(value: string): void {
    this.newEnemyName.set(value);
  }

  protected addEnemy(): void {
    this.stats.addWatchedEnemy(this.newEnemyName());
    this.newEnemyName.set('');
  }

  protected removeEnemy(name: string): void {
    this.stats.removeWatchedEnemy(name);
  }

  protected setNewItemName(value: string): void {
    this.newItemName.set(value);
  }

  protected addItem(): void {
    this.stats.addWatchedItem(this.newItemName());
    this.newItemName.set('');
  }

  protected removeItem(name: string): void {
    this.stats.removeWatchedItem(name);
  }

  private dragEnemyIndex: number | null = null;
  private dragItemIndex: number | null = null;

  protected onEnemyDragStart(index: number): void {
    this.dragEnemyIndex = index;
  }

  protected onEnemyDrop(index: number): void {
    if (this.dragEnemyIndex !== null && this.dragEnemyIndex !== index) {
      this.stats.reorderEnemyWatchlist(this.dragEnemyIndex, index);
    }
    this.dragEnemyIndex = null;
  }

  protected onItemDragStart(index: number): void {
    this.dragItemIndex = index;
  }

  protected onItemDrop(index: number): void {
    if (this.dragItemIndex !== null && this.dragItemIndex !== index) {
      this.stats.reorderItemWatchlist(this.dragItemIndex, index);
    }
    this.dragItemIndex = null;
  }
}
