import { Component, inject, signal } from '@angular/core';
import { StatsStoreService } from '../../core/services/stats-store.service';
import { NumberFrPipe } from '../../shared/number-fr.pipe';

@Component({
  selector: 'app-tracker',
  imports: [NumberFrPipe],
  templateUrl: './tracker.component.html',
  styleUrl: './tracker.component.css',
})
export class TrackerComponent {
  protected readonly stats = inject(StatsStoreService);

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
}
