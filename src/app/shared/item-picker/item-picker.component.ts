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
import { ItemPickerRequest } from '../../core/services/item-picker.service';
import { wakfuRarityIconUrl } from '../../core/data/wakfu-item-rarity.data';
import { ItemIconComponent } from '../item-icon/item-icon.component';
import { TranslatePipe } from '../translate.pipe';

/**
 * Sélecteur d'objet homonyme (correction manuelle de l'id catalogue retenu pour une ligne de
 * butin/achat/échange) — même principe/positionnement que ClassPickerComponent/
 * DamageReassignPickerComponent (rendu une seule fois au niveau racine, voir leur commentaire pour
 * le piège `position: fixed` niché dans un ancêtre `transform`).
 */
@Component({
  selector: 'app-item-picker',
  imports: [ItemIconComponent, TranslatePipe],
  templateUrl: './item-picker.component.html',
  styleUrl: './item-picker.component.css',
})
export class ItemPickerComponent implements OnDestroy {
  readonly request = input.required<ItemPickerRequest>();
  readonly itemChosen = output<number>();
  readonly closed = output<void>();

  private readonly catalog = inject(CatalogService);
  private readonly i18n = inject(I18nService);

  protected readonly candidates = computed<CatalogItemEntry[]>(() => {
    this.catalog.revision(); // dépendance réactive : recalcule une fois le catalogue chargé
    return this.catalog.findAllWakfuItemEntriesByName(this.request().name);
  });

  private readonly pickerEl = viewChild<ElementRef<HTMLDivElement>>('picker');
  /** Même repositionnement anti-débordement que ClassPickerComponent/DamageReassignPickerComponent. */
  protected readonly displayPosition = signal({ left: 0, top: 0 });
  private resizeObserver?: ResizeObserver;

  constructor() {
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

  protected choose(entry: CatalogItemEntry): void {
    this.itemChosen.emit(entry.id);
  }

  protected close(): void {
    this.closed.emit();
  }
}
