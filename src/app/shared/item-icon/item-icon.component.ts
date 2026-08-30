import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { CatalogService, CatalogItemEntry } from '../../core/api/catalog.service';
import { WAKFU_ITEM_IMAGE_OVERRIDES } from '../../core/data/wakfu-item-image-overrides.data';
import { normalizeWakfuName } from '../../core/utils/wakfu-name.util';

/**
 * Construit la liste des URLs candidates pour un objet : wakassets, seule
 * source actuelle. Contrairement à l'ancienne version (basée sur
 * wakfu-items.data.ts), pas de repli sur l'image officielle Ankama :
 * `pictureUrl` n'est pas déductible du gfxId et a été volontairement exclu
 * de l'index compact servi par l'API (voir server/catalog/compact-index.ts).
 */
function itemImageCandidates(entry: CatalogItemEntry): string[] {
  return [`https://vertylo.github.io/wakassets/items/${entry.gfxId}.png`];
}

/**
 * Icône précédant un objet (butin, suivi de ressources). Illustration réelle
 * résolue via une chaîne de sources, dans l'ordre : recours manuel direct
 * (wakfu-item-image-overrides.data.ts, pour les objets absents du
 * référentiel) puis, pour un objet connu (voir wakfu-items.data.ts), les
 * sources déterminées par `itemImageCandidates` selon la disponibilité
 * réelle de l'objet sur chaque CDN, essayées l'une après l'autre en cas
 * d'échec de chargement. Repli final sur une icône générique si tout échoue
 * ou si l'objet est inconnu.
 */
@Component({
  selector: 'app-item-icon',
  template: `
    @if (imgSrc(); as src) {
      <img
        class="item-icon-img"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [src]="src"
        referrerpolicy="no-referrer"
        draggable="false"
        (error)="onError()"
        alt=""
      />
    } @else {
      <svg
        class="item-icon"
        [style.width.px]="size()"
        [style.height.px]="size()"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M6 8l1.5-4h9L18 8" />
        <path d="M4 8h16l-1 11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 8z" />
        <path d="M9 11v2a3 3 0 0 0 6 0v-2" />
      </svg>
    }
  `,
  styles: [
    `
      .item-icon {
        color: #999;
        flex-shrink: 0;
      }
      .item-icon-img {
        object-fit: contain;
        border-radius: 3px;
        flex-shrink: 0;
      }
    `,
  ],
})
export class ItemIconComponent {
  readonly name = input.required<string>();
  /** Id Ankama de l'objet, quand déjà connu (ex. capturé à la sélection dans l'autocomplétion) —
   * résolution non ambiguë à préférer à `name` seul, qui ne suffit pas à distinguer deux objets
   * homonymes (ex. "Larme d'Ogrest", deux ids distincts dans le référentiel). `null` (défaut) :
   * repli sur la résolution par nom, comme avant ce champ. */
  readonly id = input<number | null>(null);
  /** Taille en px (carrée). Par défaut 18px, comme dans les listes de suivi/butin. */
  readonly size = input(18);

  private readonly catalog = inject(CatalogService);

  private readonly candidates = computed(() => {
    this.catalog.revision(); // dépendance réactive : recalcule une fois le catalogue chargé
    const key = normalizeWakfuName(this.name());
    const override = WAKFU_ITEM_IMAGE_OVERRIDES[key];
    if (override) return [override];
    const byId = this.id();
    const entry =
      (byId !== null ? this.catalog.findWakfuItemEntryById(byId) : undefined) ??
      this.catalog.findWakfuItemEntry(this.name());
    return entry ? itemImageCandidates(entry) : [];
  });

  /** Reprend candidates()[0] à chaque changement d'objet ; onError() avance dans la liste. */
  protected readonly imgSrc = linkedSignal<string | null>(() => this.candidates()[0] ?? null);

  protected onError(): void {
    const list = this.candidates();
    const currentIndex = list.indexOf(this.imgSrc() ?? '');
    this.imgSrc.set(list[currentIndex + 1] ?? null);
  }
}
