import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  viewChild,
  signal,
} from '@angular/core';
import { CatalogService, CatalogItemEntry } from '../../core/api/catalog.service';
import { I18nService } from '../../core/services/i18n.service';
import { PurchaseReassignRequest } from '../../core/services/purchase-reassign.service';
import { PurchaseRecord } from '../../core/services/stats-store.service';
import { wakfuRarityIconUrl } from '../../core/data/wakfu-item-rarity.data';
import { ItemIconComponent } from '../item-icon/item-icon.component';
import { TranslatePipe } from '../translate.pipe';
import { LocaleNumberPipe } from '../locale-number.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';
import { EscapeCloseDirective } from '../escape-close.directive';

/**
 * Modale de réattribution de rareté pour l'historique des achats (voir PurchasesComponent,
 * PurchaseReassignService) — variante d'ItemPickerComponent dédiée à ce seul cas d'usage : au lieu
 * d'un stepper quantité/kamas, affiche le détail des achats individuels composant la ligne agrégée
 * (voir `PurchaseReassignRequest.records`) et laisse l'utilisateur cocher ceux à réattribuer.
 * Même principe/positionnement que ClassPickerComponent/DamageReassignPickerComponent/
 * ItemPickerComponent (rendu une seule fois au niveau racine, voir leur commentaire pour le piège
 * `position: fixed` niché dans un ancêtre `transform`).
 */
@Component({
  selector: 'app-purchase-reassign-picker',
  imports: [
    ItemIconComponent,
    TranslatePipe,
    LocaleNumberPipe,
    TooltipDirective,
    EscapeCloseDirective,
  ],
  templateUrl: './purchase-reassign-picker.component.html',
  styleUrl: './purchase-reassign-picker.component.css',
})
export class PurchaseReassignPickerComponent implements OnDestroy {
  readonly request = input.required<PurchaseReassignRequest>();
  readonly recordsChosen = output<{ records: readonly PurchaseRecord[]; catalogId: number }>();
  readonly closed = output<void>();

  private readonly catalog = inject(CatalogService);
  protected readonly i18n = inject(I18nService);

  protected readonly candidates = computed<CatalogItemEntry[]>(() => {
    this.catalog.revision(); // dépendance réactive : recalcule une fois le catalogue chargé
    return this.catalog.findAllWakfuItemEntriesByName(this.request().name);
  });

  /** Section affichée seulement s'il existe plusieurs objets candidats pour ce nom — sinon rien à
   * désambiguïser (même condition qu'ItemPickerComponent.showModify, `onChosen` est ici toujours
   * fourni par PurchasesComponent). */
  protected readonly showModify = computed(() => this.candidates().length > 1);

  /** Achats individuels sélectionnés (voir `PurchaseReassignRequest.records`) — tous sélectionnés
   * par défaut à chaque nouvelle ouverture (équivalent de l'ancien stepper de quantité réglé au
   * maximum) ; l'utilisateur décoche celles qu'il ne veut PAS voir réattribuées. */
  protected readonly selectedIds = signal<ReadonlySet<number>>(new Set());

  protected readonly hasSelection = computed(() => this.selectedIds().size > 0);

  private readonly pickerEl = viewChild<ElementRef<HTMLDivElement>>('picker');
  /** Même repositionnement anti-débordement qu'ItemPickerComponent. */
  protected readonly displayPosition = signal({ left: 0, top: 0 });
  private resizeObserver?: ResizeObserver;

  constructor() {
    effect(() => {
      // Dépendance explicite : une nouvelle requête (nouvelle ligne visée) doit repartir avec
      // toutes ses lignes de détail sélectionnées, pas garder la sélection de la précédente.
      this.selectedIds.set(new Set(this.request().records.map((r) => r.id)));
    });
    effect(() => {
      this.request();
      const el = this.pickerEl()?.nativeElement;
      this.resizeObserver?.disconnect();
      if (!el) return;
      this.resizeObserver = new ResizeObserver(() => this.updateDisplayPosition(el));
      this.resizeObserver.observe(el);
      this.updateDisplayPosition(el);
    });
  }

  private updateDisplayPosition(el: HTMLElement): void {
    const pos = this.request();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - el.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - el.offsetHeight - margin);
    this.displayPosition.set({
      left: Math.min(pos.x, maxLeft),
      top: Math.min(pos.y, maxTop),
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  protected rarityIconUrl(entry: CatalogItemEntry): string {
    return wakfuRarityIconUrl(entry.rarity);
  }

  protected label(entry: CatalogItemEntry): string {
    return entry[this.i18n.locale()];
  }

  protected isCurrent(entry: CatalogItemEntry): boolean {
    return entry.id === this.request().currentId;
  }

  protected isSelected(record: PurchaseRecord): boolean {
    return this.selectedIds().has(record.id);
  }

  protected toggleRecord(record: PurchaseRecord): void {
    const updated = new Set(this.selectedIds());
    if (updated.has(record.id)) updated.delete(record.id);
    else updated.add(record.id);
    this.selectedIds.set(updated);
  }

  /** Heure brute du log ("HH:MM:SS,mmm", voir PurchaseRecord.time) sans les millisecondes — déjà
   * dans ce format quelle que soit la langue courante, pas besoin d'un formatteur i18n dédié pour
   * cet affichage compact (contrairement à `i18n.formatDateTime`, pensé pour une date complète). */
  protected timeLabel(record: PurchaseRecord): string {
    return record.time.split(',')[0] ?? record.time;
  }

  protected follow(): void {
    if (this.request().isWatched) return;
    this.request().onFollow();
  }

  protected choose(entry: CatalogItemEntry): void {
    if (this.isCurrent(entry) || !this.hasSelection()) return;
    const ids = this.selectedIds();
    const selected = this.request().records.filter((r) => ids.has(r.id));
    this.recordsChosen.emit({ records: selected, catalogId: entry.id });
  }

  protected close(): void {
    this.closed.emit();
  }
}
