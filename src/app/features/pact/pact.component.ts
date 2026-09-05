import { Component, computed, inject, signal } from '@angular/core';
import {
  PactExtractionRecord,
  StatsStoreService,
  TradeItemRow,
} from '../../core/services/stats-store.service';
import { I18nService } from '../../core/services/i18n.service';
import { LocaleNumberPipe } from '../../shared/locale-number.pipe';
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

type PactSortOrder = 'desc' | 'asc';

/** Un jour d'extractions de pacte : extractions individuelles (voir
 * StatsStoreService.pactExtractionHistory), triées selon le même ordre que les groupes
 * (`PactComponent.sortOrder`) — même principe que TradesComponent, une extraction n'a qu'un seul
 * tableau d'objets (contrairement à un échange, pas de sens acquis/cédé). */
interface PactDateGroup {
  dateKey: string;
  records: PactExtractionRecord[];
}

/**
 * Historique des extractions de pacte, regroupé par jour (en-têtes repliables) — même principe que
 * TradesComponent (une extraction, comme un échange, n'est jamais agrégée entre elle et une autre :
 * chaque extraction garde sa propre ligne avec son propre horodatage, voir CLAUDE.md).
 */
@Component({
  selector: 'app-pact',
  imports: [
    LocaleNumberPipe,
    TranslatePipe,
    ItemIconComponent,
    HistoryListHeaderComponent,
    IconComponent,
    TooltipDirective,
  ],
  templateUrl: './pact.component.html',
  styleUrl: './pact.component.css',
})
export class PactComponent {
  private readonly archive = inject(HistoryArchiveService);
  protected readonly i18n = inject(I18nService);
  private readonly catalog = inject(CatalogService);
  private readonly stats = inject(StatsStoreService);
  private readonly itemPicker = inject(ItemPickerService);

  /** Extractions affichées : session en cours + archive du compte fusionnées et dédoublonnées (voir
   * HistoryArchiveService.mergedPactExtractions). */
  private readonly records = computed<readonly PactExtractionRecord[]>(() =>
    this.archive.mergedPactExtractions(),
  );

  protected readonly searchQuery = signal('');
  protected readonly sortOrder = signal<PactSortOrder>('desc');
  /** Clés de date (voir `PactDateGroup.dateKey`) actuellement repliées — vide par défaut (tout déplié). */
  private readonly collapsedDates = signal<ReadonlySet<string>>(new Set());

  protected readonly groups = computed<PactDateGroup[]>(() => {
    const query = normalizeWakfuName(this.searchQuery().trim());
    const order = this.sortOrder();

    const filtered = this.records().filter((record) => {
      if (!query) return true;
      const dateLabel = normalizeWakfuName(this.i18n.formatDate(record.fullTimestampMs));
      const itemMatch = record.items.some((item) =>
        normalizeWakfuName(this.i18n.translateItemName(item.name)).includes(query),
      );
      return dateLabel.includes(query) || itemMatch;
    });

    const byDate = new Map<string, PactExtractionRecord[]>();
    for (const record of filtered) {
      const key = this.i18n.formatRelativeDay(record.fullTimestampMs);
      const list = byDate.get(key);
      if (list) list.push(record);
      else byDate.set(key, [record]);
    }

    const groups: PactDateGroup[] = [...byDate.entries()].map(([dateKey, records]) => ({
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
   * sinon rien à désambiguïser, voir LootListComponent.canInteract/TradesComponent.canInteract
   * (même règle, ItemPickerComponent partagé). */
  protected canInteract(item: TradeItemRow): boolean {
    return this.catalog.hasMultipleWakfuItemEntriesByName(item.name);
  }

  protected openInteractMenu(
    event: MouseEvent,
    record: PactExtractionRecord,
    item: TradeItemRow,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canInteract(item)) return;
    // Cible la ligne par son `catalogId` ACTUEL (voir StatsStoreService.reassignPactItem,
    // `sourceCatalogId`) plutôt que par un rang positionnel — insensible à l'ordre d'affichage.
    this.itemPicker.open({
      name: item.name,
      x: event.clientX,
      y: event.clientY,
      currentId: item.catalogId,
      quantity: item.quantity,
      onChosen: (id, quantity) => {
        this.stats.reassignPactItem(record, item.name, item.catalogId, quantity, id);
        this.archive.reassignPactItem(record, item.name, item.catalogId, quantity, id);
      },
    });
  }
}
