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
import { TooltipDirective } from '../tooltip/tooltip.directive';
import { InputNumberComponent } from '../input-number/input-number.component';

/**
 * Menu d'interaction avec un objet (suivi + correction manuelle d'homonyme, voir
 * ItemPickerService) — même principe/positionnement que ClassPickerComponent/
 * DamageReassignPickerComponent (rendu une seule fois au niveau racine, voir leur commentaire pour
 * le piège `position: fixed` niché dans un ancêtre `transform`).
 */
@Component({
  selector: 'app-item-picker',
  imports: [ItemIconComponent, TranslatePipe, TooltipDirective, InputNumberComponent],
  templateUrl: './item-picker.component.html',
  styleUrl: './item-picker.component.css',
})
export class ItemPickerComponent implements OnDestroy {
  readonly request = input.required<ItemPickerRequest>();
  readonly itemChosen = output<{ id: number; quantity: number }>();
  readonly closed = output<void>();

  private readonly catalog = inject(CatalogService);
  private readonly i18n = inject(I18nService);

  protected readonly candidates = computed<CatalogItemEntry[]>(() => {
    this.catalog.revision(); // dépendance réactive : recalcule une fois le catalogue chargé
    return this.catalog.findAllWakfuItemEntriesByName(this.request().name);
  });

  /** Section correction affichée seulement si l'appelant l'autorise (voir
   * `ItemPickerRequest.onChosen`, absent pour le butin cumulé de session) ET qu'il existe
   * effectivement plus d'un objet candidat pour ce nom — sinon rien à désambiguïser. */
  protected readonly showModify = computed(
    () => this.request().onChosen !== undefined && this.candidates().length > 1,
  );

  /** Quantité concernée par la correction — bornée à [1, request().quantity], remise à la valeur
   * maximale (tout le lot) à chaque nouvelle ouverture, voir l'effect ci-dessous. */
  protected readonly quantity = signal(1);

  private readonly pickerEl = viewChild<ElementRef<HTMLDivElement>>('picker');
  /** Même repositionnement anti-débordement que ClassPickerComponent/DamageReassignPickerComponent. */
  protected readonly displayPosition = signal({ left: 0, top: 0 });
  private resizeObserver?: ResizeObserver;

  constructor() {
    effect(() => {
      // Dépendance explicite : une nouvelle requête (nouvelle ligne visée) doit repartir sur la
      // quantité totale de CETTE ligne, pas garder la valeur ajustée pour la précédente.
      this.quantity.set(this.request().quantity);
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

  private clampQuantity(value: number): number {
    const max = Math.max(1, this.request().quantity);
    if (!Number.isFinite(value)) return 1;
    return Math.min(max, Math.max(1, Math.floor(value)));
  }

  protected follow(): void {
    if (this.request().isWatched) return;
    this.request().onFollow();
  }

  protected choose(entry: CatalogItemEntry): void {
    if (this.isCurrent(entry)) return;
    this.itemChosen.emit({ id: entry.id, quantity: this.clampQuantity(this.quantity()) });
  }

  protected close(): void {
    this.closed.emit();
  }
}
