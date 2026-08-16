import { Component, computed, inject, signal } from '@angular/core';
import { PurchaseRecord, StatsStoreService } from '../../core/services/stats-store.service';
import { I18nService } from '../../core/services/i18n.service';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { TranslatePipe } from '../../shared/translate.pipe';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { getWakfuItemRarity } from '../../core/data/wakfu-item-rarity.data';
import { normalizeWakfuName } from '../../core/utils/wakfu-name.util';
import { HistoryListHeaderComponent } from '../../shared/history-list-header/history-list-header.component';
import { CatalogService } from '../../core/api/catalog.service';
import { HistoryArchiveService } from '../../core/sync/history-archive.service';
import { ItemPickerService } from '../../core/services/item-picker.service';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';

type PurchaseSortOrder = 'desc' | 'asc';

/** Achats d'un même objet regroupés au sein d'une journée (voir `PurchaseDateGroup`) : quantité et
 * coût cumulés plutôt qu'une ligne par achat individuel — `lastTimestampMs` (le plus récent des
 * achats agrégés) sert uniquement de clé de tri au sein du jour, pas affiché tel quel (un objet
 * racheté plusieurs fois dans la journée n'a plus une heure unique à montrer). `records` garde les
 * achats individuels ayant composé cette ligne — nécessaire pour cibler une correction manuelle
 * d'objet (voir ItemPickerService) : chacun a sa propre clé de dédoublonnage
 * (`time`/`quantity`/`totalCost` propres), la ligne agrégée elle-même n'en a pas. `catalogId` :
 * celui du dernier achat agrégé (représentatif pour l'icône/la rareté affichées). */
interface PurchaseAggregateRow {
  item: string;
  catalogId: number | null;
  quantity: number;
  totalCost: number;
  lastTimestampMs: number;
  records: PurchaseRecord[];
}

/** Un jour d'achats : total tous objets confondus + achats agrégés par objet
 * (voir StatsStoreService.purchaseHistory), triés selon le même ordre que
 * les groupes (`PurchasesComponent.sortOrder`). */
interface PurchaseDateGroup {
  dateKey: string;
  totalCost: number;
  rows: PurchaseAggregateRow[];
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
  imports: [
    NumberFrPipe,
    TranslatePipe,
    ItemIconComponent,
    IconComponent,
    HistoryListHeaderComponent,
    TooltipDirective,
  ],
  templateUrl: './purchases.component.html',
  styleUrl: './purchases.component.css',
})
export class PurchasesComponent {
  private readonly archive = inject(HistoryArchiveService);
  protected readonly i18n = inject(I18nService);
  private readonly catalog = inject(CatalogService);
  private readonly stats = inject(StatsStoreService);
  private readonly itemPicker = inject(ItemPickerService);

  /** Achats affichés : session en cours + archive du compte fusionnées et dédoublonnées (voir
   * HistoryArchiveService.mergedPurchases). */
  private readonly records = computed<readonly PurchaseRecord[]>(() =>
    this.archive.mergedPurchases(),
  );

  protected readonly searchQuery = signal('');
  protected readonly sortOrder = signal<PurchaseSortOrder>('desc');
  /** Clés de date (voir `PurchaseDateGroup.dateKey`) actuellement repliées — vide par défaut (tout déplié). */
  private readonly collapsedDates = signal<ReadonlySet<string>>(new Set());

  protected readonly groups = computed<PurchaseDateGroup[]>(() => {
    const query = normalizeWakfuName(this.searchQuery().trim());
    const order = this.sortOrder();

    const filtered = this.records().filter((record) => {
      if (!query) return true;
      const name = normalizeWakfuName(this.i18n.translateItemName(record.item));
      const dateLabel = normalizeWakfuName(this.i18n.formatDate(record.fullTimestampMs));
      return name.includes(query) || dateLabel.includes(query);
    });

    const byDate = new Map<string, PurchaseRecord[]>();
    for (const record of filtered) {
      const key = this.i18n.formatRelativeDay(record.fullTimestampMs);
      const list = byDate.get(key);
      if (list) list.push(record);
      else byDate.set(key, [record]);
    }

    const groups: PurchaseDateGroup[] = [...byDate.entries()].map(([dateKey, records]) => {
      const byItem = new Map<string, PurchaseAggregateRow>();
      for (const record of records) {
        const existing = byItem.get(record.item);
        if (existing) {
          existing.quantity += record.quantity;
          existing.totalCost += record.totalCost;
          if (record.fullTimestampMs >= existing.lastTimestampMs)
            existing.catalogId = record.catalogId;
          existing.lastTimestampMs = Math.max(existing.lastTimestampMs, record.fullTimestampMs);
          existing.records.push(record);
        } else {
          byItem.set(record.item, {
            item: record.item,
            catalogId: record.catalogId,
            quantity: record.quantity,
            totalCost: record.totalCost,
            lastTimestampMs: record.fullTimestampMs,
            records: [record],
          });
        }
      }
      const rows = [...byItem.values()].sort((a, b) =>
        order === 'desc'
          ? b.lastTimestampMs - a.lastTimestampMs
          : a.lastTimestampMs - b.lastTimestampMs,
      );
      return {
        dateKey,
        totalCost: records.reduce((sum, r) => sum + r.totalCost, 0),
        rows,
      };
    });

    groups.sort((a, b) => {
      const aTime = a.rows[0]?.lastTimestampMs ?? 0;
      const bTime = b.rows[0]?.lastTimestampMs ?? 0;
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

  protected rarityClass(row: PurchaseAggregateRow): string {
    return `rarity-${getWakfuItemRarity(this.catalog, row.item, row.catalogId)}`;
  }

  /** Corrige TOUS les achats individuels ayant composé cette ligne agrégée (voir
   * `PurchaseAggregateRow.records`) — un objet homonyme est un attribut de l'OBJET lui-même, pas
   * d'un achat isolé, donc la correction se comporte comme "cet objet est en réalité celui-ci"
   * plutôt que "cet achat précis". */
  protected correctItem(event: MouseEvent, row: PurchaseAggregateRow): void {
    event.preventDefault();
    event.stopPropagation();
    this.itemPicker.open({
      name: row.item,
      x: event.clientX,
      y: event.clientY,
      currentId: row.catalogId,
      onChosen: (id) => {
        for (const record of row.records) {
          this.stats.reassignPurchaseItem(record, id);
          this.archive.reassignPurchaseItem(record, id);
        }
      },
    });
  }
}
