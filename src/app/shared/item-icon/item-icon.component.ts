import { Component, computed, input, linkedSignal } from '@angular/core';
import { WAKFU_ITEMS_FR } from '../../core/data/wakfu-items.data';
import { WAKFU_ITEM_IMAGE_OVERRIDES } from '../../core/data/wakfu-item-image-overrides.data';

const GFX_ID_IMAGE_SOURCES: readonly ((gfxId: number) => string)[] = [
  (gfxId) => `https://raw.githubusercontent.com/Nexus-Hub/Wakfu-Companion/master/public/assets/img/items/${gfxId}.png`,
  (gfxId) => `https://cdn.wakfuli.com/items/${gfxId}.webp`,
];

/**
 * Icône précédant un objet (butin, suivi de ressources). Illustration réelle
 * résolue via une chaîne de sources, dans l'ordre : recours manuel direct
 * (wakfu-item-image-overrides.data.ts, pour les objets absents des
 * catalogues officiels) puis, pour un objet connu (voir
 * wakfu-items.data.ts), les CDN indexant par gfxId (Nexus-Hub, Wakfuli),
 * essayés l'un après l'autre en cas d'échec de chargement. Repli final sur
 * une icône générique si tout échoue ou si l'objet est inconnu.
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
  /** Taille en px (carrée). Par défaut 18px, comme dans les listes de suivi/butin. */
  readonly size = input(18);

  private readonly candidates = computed(() => {
    const key = this.name().toLowerCase().trim();
    const override = WAKFU_ITEM_IMAGE_OVERRIDES[key];
    if (override) return [override];
    const entry = WAKFU_ITEMS_FR[key];
    return entry ? GFX_ID_IMAGE_SOURCES.map((source) => source(entry.gfxId)) : [];
  });

  /** Reprend candidates()[0] à chaque changement d'objet ; onError() avance dans la liste. */
  protected readonly imgSrc = linkedSignal<string | null>(() => this.candidates()[0] ?? null);

  protected onError(): void {
    const list = this.candidates();
    const currentIndex = list.indexOf(this.imgSrc() ?? '');
    this.imgSrc.set(list[currentIndex + 1] ?? null);
  }
}
