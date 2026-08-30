import { Component, computed, inject, signal } from '@angular/core';
import {
  StatsStoreService,
  TradeItemRow,
  TradeRecord,
} from '../../core/services/stats-store.service';
import { I18nService } from '../../core/services/i18n.service';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { TranslatePipe } from '../../shared/translate.pipe';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { getWakfuItemRarity } from '../../core/data/wakfu-item-rarity.data';
import { normalizeWakfuName } from '../../core/utils/wakfu-name.util';
import { HistoryListHeaderComponent } from '../../shared/history-list-header/history-list-header.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { CatalogService } from '../../core/api/catalog.service';
import { HistoryArchiveService } from '../../core/sync/history-archive.service';
import { ItemPickerService } from '../../core/services/item-picker.service';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';

type TradeSortOrder = 'desc' | 'asc';

/** Un jour d'échanges : échanges individuels (voir StatsStoreService.tradeHistory),
 * triés selon le même ordre que les groupes (`TradesComponent.sortOrder`). */
interface TradeDateGroup {
  dateKey: string;
  records: TradeRecord[];
}

/**
 * Historique des échanges, regroupé par jour (en-têtes repliables) — même
 * principe que PurchasesComponent. Aucun parser n'alimente encore
 * `StatsStoreService.tradeHistory` (le log Wakfu n'est pas encore décodé
 * pour les échanges) : ce composant est fonctionnel dès aujourd'hui
 * (recherche, tri, repli) mais affiche l'état vide tant que ce signal reste
 * à `[]`.
 */
@Component({
  selector: 'app-trades',
  imports: [
    NumberFrPipe,
    TranslatePipe,
    ItemIconComponent,
    HistoryListHeaderComponent,
    IconComponent,
    TooltipDirective,
  ],
  templateUrl: './trades.component.html',
  styleUrl: './trades.component.css',
})
export class TradesComponent {
  private readonly archive = inject(HistoryArchiveService);
  protected readonly i18n = inject(I18nService);
  private readonly catalog = inject(CatalogService);
  private readonly stats = inject(StatsStoreService);
  private readonly itemPicker = inject(ItemPickerService);

  /** Échanges affichés : session en cours + archive du compte fusionnées et dédoublonnées (voir
   * HistoryArchiveService.mergedTrades). */
  private readonly records = computed<readonly TradeRecord[]>(() => this.archive.mergedTrades());

  protected readonly searchQuery = signal('');
  protected readonly sortOrder = signal<TradeSortOrder>('desc');
  /** Clés de date (voir `TradeDateGroup.dateKey`) actuellement repliées — vide par défaut (tout déplié). */
  private readonly collapsedDates = signal<ReadonlySet<string>>(new Set());

  protected readonly groups = computed<TradeDateGroup[]>(() => {
    const query = normalizeWakfuName(this.searchQuery().trim());
    const order = this.sortOrder();

    const filtered = this.records().filter((record) => {
      if (!query) return true;
      const character = normalizeWakfuName(record.characterName);
      const dateLabel = normalizeWakfuName(this.i18n.formatDate(record.fullTimestampMs));
      const itemMatch = [...record.acquired, ...record.given].some((item) =>
        normalizeWakfuName(this.i18n.translateItemName(item.name)).includes(query),
      );
      return character.includes(query) || dateLabel.includes(query) || itemMatch;
    });

    const byDate = new Map<string, TradeRecord[]>();
    for (const record of filtered) {
      const key = this.i18n.formatRelativeDay(record.fullTimestampMs);
      const list = byDate.get(key);
      if (list) list.push(record);
      else byDate.set(key, [record]);
    }

    const groups: TradeDateGroup[] = [...byDate.entries()].map(([dateKey, records]) => ({
      dateKey,
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

  protected rarityClass(item: TradeItemRow): string {
    return `rarity-${getWakfuItemRarity(this.catalog, item.name, item.catalogId)}`;
  }

  /** Une correction n'a de sens que si le référentiel Ankama connaît plusieurs objets de ce nom —
   * sinon rien à désambiguïser, voir LootListComponent.canInteract (même règle, ItemPickerComponent
   * partagé) et CLAUDE.md (bouton "Suivre" retiré de ce menu). */
  protected canInteract(item: TradeItemRow): boolean {
    return this.catalog.findAllWakfuItemEntriesByName(item.name).length > 1;
  }

  protected openInteractMenu(
    event: MouseEvent,
    record: TradeRecord,
    direction: 'acquired' | 'given',
    item: TradeItemRow,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canInteract(item)) return;
    // Cible la ligne par son `catalogId` ACTUEL (voir StatsStoreService.reassignTradeItem,
    // `sourceCatalogId`) plutôt que par un rang positionnel — insensible à l'ordre d'affichage.
    this.itemPicker.open({
      name: item.name,
      x: event.clientX,
      y: event.clientY,
      currentId: item.catalogId,
      quantity: item.quantity,
      onChosen: (id, quantity) => {
        this.stats.reassignTradeItem(record, direction, item.name, item.catalogId, quantity, id);
        this.archive.reassignTradeItem(record, direction, item.name, item.catalogId, quantity, id);
      },
    });
  }
}
