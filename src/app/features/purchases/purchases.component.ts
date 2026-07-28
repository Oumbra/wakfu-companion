import { Component, computed, inject, signal } from '@angular/core';
import { PurchaseRecord, StatsStoreService } from '../../core/services/stats-store.service';
import { I18nService } from '../../core/services/i18n.service';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { TranslatePipe } from '../../shared/translate.pipe';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { getWakfuItemRarity } from '../../core/data/wakfu-item-rarity.data';
import { normalizeWakfuName } from '../../core/utils/wakfu-name.util';

type PurchaseSortOrder = 'desc' | 'asc';

/** Un jour d'achats : total tous objets confondus + achats individuels
 * (voir StatsStoreService.purchaseHistory), triés selon le même ordre que
 * les groupes (`PurchasesComponent.sortOrder`). */
interface PurchaseDateGroup {
  dateKey: string;
  totalCost: number;
  records: PurchaseRecord[];
}

/**
 * Historique des achats, regroupé par jour (en-têtes repliables). Aucun
 * parser n'alimente encore `StatsStoreService.purchaseHistory` (le log
 * Wakfu n'est pas encore décodé pour les achats) : ce composant est
 * fonctionnel dès aujourd'hui (recherche, tri, repli) mais affiche l'état
 * vide tant que ce signal reste à `[]`.
 */
@Component({
  selector: 'app-purchases',
  imports: [NumberFrPipe, TranslatePipe, ItemIconComponent],
  templateUrl: './purchases.component.html',
  styleUrl: './purchases.component.css',
})
export class PurchasesComponent {
  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);

  protected readonly searchQuery = signal('');
  protected readonly sortOrder = signal<PurchaseSortOrder>('desc');
  /** Clés de date (voir `PurchaseDateGroup.dateKey`) actuellement repliées — vide par défaut (tout déplié). */
  private readonly collapsedDates = signal<ReadonlySet<string>>(new Set());

  protected readonly groups = computed<PurchaseDateGroup[]>(() => {
    const query = normalizeWakfuName(this.searchQuery().trim());
    const order = this.sortOrder();

    const filtered = this.stats.purchaseHistory().filter((record) => {
      if (!query) return true;
      const name = normalizeWakfuName(this.i18n.translateItemName(record.item));
      const dateLabel = normalizeWakfuName(this.i18n.formatDate(record.fullTimestampMs));
      return name.includes(query) || dateLabel.includes(query);
    });

    const byDate = new Map<string, PurchaseRecord[]>();
    for (const record of filtered) {
      const key = this.i18n.formatDate(record.fullTimestampMs);
      const list = byDate.get(key);
      if (list) list.push(record);
      else byDate.set(key, [record]);
    }

    const groups: PurchaseDateGroup[] = [...byDate.entries()].map(([dateKey, records]) => ({
      dateKey,
      totalCost: records.reduce((sum, r) => sum + r.totalCost, 0),
      records: records.sort((a, b) =>
        order === 'desc'
          ? b.fullTimestampMs - a.fullTimestampMs
          : a.fullTimestampMs - b.fullTimestampMs,
      ),
    }));

    groups.sort((a, b) => {
      const aTime = a.records[0]?.fullTimestampMs ?? 0;
      const bTime = b.records[0]?.fullTimestampMs ?? 0;
      return order === 'desc' ? bTime - aTime : aTime - bTime;
    });
    return groups;
  });

  protected isCollapsed(dateKey: string): boolean {
    return this.collapsedDates().has(dateKey);
  }

  protected toggleGroup(dateKey: string): void {
    const updated = new Set(this.collapsedDates());
    if (updated.has(dateKey)) updated.delete(dateKey);
    else updated.add(dateKey);
    this.collapsedDates.set(updated);
  }

  protected setSortOrder(order: PurchaseSortOrder): void {
    this.sortOrder.set(order);
  }

  protected setSearchQuery(value: string): void {
    this.searchQuery.set(value);
  }

  protected rarityClass(name: string): string {
    return `rarity-${getWakfuItemRarity(name)}`;
  }
}
