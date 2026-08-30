import { Component, computed, inject, signal } from '@angular/core';
import {
  HDV_KAMAS_SALE_ITEM,
  PurchaseRecord,
  StatsStoreService,
} from '../../core/services/stats-store.service';
import { I18nService } from '../../core/services/i18n.service';
import { LocaleNumberPipe } from '../../shared/locale-number.pipe';
import { TranslatePipe } from '../../shared/translate.pipe';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { getWakfuItemRarity } from '../../core/data/wakfu-item-rarity.data';
import { WAKFU_HDV_KAMAS_ICON_URL } from '../../core/data/wakfu-item-category.data';
import { normalizeWakfuName } from '../../core/utils/wakfu-name.util';
import { HistoryListHeaderComponent } from '../../shared/history-list-header/history-list-header.component';
import { CatalogService } from '../../core/api/catalog.service';
import { HistoryArchiveService } from '../../core/sync/history-archive.service';
import { PurchaseReassignService } from '../../core/services/purchase-reassign.service';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';

type PurchaseSortOrder = 'desc' | 'asc';

/** Achats d'un même objet regroupés au sein d'une journée (voir `PurchaseDateGroup`) : quantité et
 * coût cumulés plutôt qu'une ligne par achat individuel — `lastTimestampMs` (le plus récent des
 * achats agrégés) sert uniquement de clé de tri au sein du jour, pas affiché tel quel (un objet
 * racheté plusieurs fois dans la journée n'a plus une heure unique à montrer). `records` garde les
 * achats individuels ayant composé cette ligne — affichés en détail sélectionnable dans la modale
 * de réattribution (voir PurchaseReassignService) : chacun a sa propre clé de dédoublonnage
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

/** Un jour d'achats : total tous objets confondus (hors récupérations de kamas à l'Hôtel de vente,
 * voir HDV_KAMAS_SALE_ITEM et le calcul de `totalCost` — pas de vrais achats) + achats agrégés par
 * objet (voir StatsStoreService.purchaseHistory), triés selon le même ordre que les groupes
 * (`PurchasesComponent.sortOrder`). */
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
    LocaleNumberPipe,
    TranslatePipe,
    ItemIconComponent,
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
  private readonly purchaseReassign = inject(PurchaseReassignService);
  protected readonly hdvIconUrl = WAKFU_HDV_KAMAS_ICON_URL;

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
      // Sentinelle (voir HDV_KAMAS_SALE_ITEM) : pas un vrai nom d'objet, translateItemName ne le
      // trouverait pas dans le catalogue et le renverrait tel quel — filtrer sur le libellé
      // traduit réellement affiché plutôt que sur la clé interne.
      const name =
        record.item === HDV_KAMAS_SALE_ITEM
          ? normalizeWakfuName(this.i18n.t('purchases.hdvSource'))
          : normalizeWakfuName(this.i18n.translateItemName(record.item));
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
      // Clé composite (nom + catalogId), PAS le nom seul : après une correction manuelle partielle
      // (voir PurchaseReassignService), deux achats du même nom mais de rareté différente doivent rester
      // deux lignes distinctes — les fusionner de nouveau ici masquerait silencieusement la
      // correction (bug réel corrigé : la ligne agrégée entière basculait visuellement sur la
      // nouvelle rareté, y compris la part non concernée par la correction).
      const byItem = new Map<string, PurchaseAggregateRow>();
      for (const record of records) {
        const key = `${record.item}|${record.catalogId ?? ''}`;
        const existing = byItem.get(key);
        if (existing) {
          existing.quantity += record.quantity;
          existing.totalCost += record.totalCost;
          existing.lastTimestampMs = Math.max(existing.lastTimestampMs, record.fullTimestampMs);
          existing.records.push(record);
        } else {
          byItem.set(key, {
            item: record.item,
            catalogId: record.catalogId,
            quantity: record.quantity,
            totalCost: record.totalCost,
            lastTimestampMs: record.fullTimestampMs,
            records: [record],
          });
        }
      }
      const rows = [...byItem.values()].sort((a, b) => {
        // Hôtel de vente toujours en tête de journée (encaissement, pas un achat — voir isHdvRow) :
        // repère visuel constant pour retrouver ce gain de kamas quel que soit le tri choisi, plutôt
        // qu'une ligne perdue au milieu des vrais achats.
        const aHdv = a.item === HDV_KAMAS_SALE_ITEM;
        const bHdv = b.item === HDV_KAMAS_SALE_ITEM;
        if (aHdv !== bHdv) return aHdv ? -1 : 1;
        return order === 'desc'
          ? b.lastTimestampMs - a.lastTimestampMs
          : a.lastTimestampMs - b.lastTimestampMs;
      });
      return {
        dateKey,
        // Une récupération de kamas à l'Hôtel de vente (voir HDV_KAMAS_SALE_ITEM) n'est pas un
        // achat au sens propre — juste un encaissement affiché dans cette même liste pour sa
        // valeur informative — donc exclue du total du jour, qui ne doit refléter que les kamas
        // réellement dépensés.
        totalCost: records
          .filter((r) => r.item !== HDV_KAMAS_SALE_ITEM)
          .reduce((sum, r) => sum + r.totalCost, 0),
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

  /** Récupération de kamas à l'Hôtel de vente (voir HDV_KAMAS_SALE_ITEM) : pas un vrai objet du
   * catalogue, affichée distinctement (libellé traduit, icône fixe, sans quantité ni menu de
   * réattribution — voir template/openInteractMenu). */
  protected isHdvRow(row: PurchaseAggregateRow): boolean {
    return row.item === HDV_KAMAS_SALE_ITEM && row.catalogId === null;
  }

  protected rarityClass(row: PurchaseAggregateRow): string {
    if (this.isHdvRow(row)) return '';
    return `rarity-${getWakfuItemRarity(this.catalog, row.item, row.catalogId)}`;
  }

  protected openInteractMenu(event: MouseEvent, row: PurchaseAggregateRow): void {
    if (this.isHdvRow(row)) return; // rien à réattribuer : ce n'est pas un objet
    event.preventDefault();
    event.stopPropagation();
    this.purchaseReassign.open({
      name: row.item,
      x: event.clientX,
      y: event.clientY,
      currentId: row.catalogId,
      records: row.records,
      isWatched: this.stats.isWatched(row.item),
      onFollow: () => this.stats.addWatchedItem(row.item),
      // Chaque achat individuel sélectionné par l'utilisateur (voir PurchaseReassignPickerComponent)
      // est réattribué EN BLOC, avec sa propre quantité/son propre coût déjà exacts — plus de
      // prorata à calculer ni de scission partielle : la sélection ligne par ligne remplace ce que
      // faisait l'ancien stepper quantité/kamas.
      onChosen: (records, id) => {
        for (const record of records) {
          this.stats.reassignPurchaseItem(record, record.quantity, id);
          this.archive.reassignPurchaseItem(record, record.quantity, id);
        }
      },
    });
  }
}
