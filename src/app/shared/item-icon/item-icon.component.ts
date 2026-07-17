import { Component, computed, input, signal } from '@angular/core';
import { WAKFU_ITEMS_FR } from '../../core/data/wakfu-items.data';

const ITEM_IMAGE_BASE_URL =
  'https://raw.githubusercontent.com/Nexus-Hub/Wakfu-Companion/master/public/assets/img/items/';

/**
 * Icône précédant un objet (butin, suivi de ressources). Illustration réelle
 * chargée en direct depuis le dépôt du site de référence si le nom (FR)
 * correspond à un objet connu dans la base officielle Ankama (voir
 * wakfu-items.data.ts), avec repli automatique sur une icône générique
 * (hors-ligne ou objet inconnu).
 */
@Component({
  selector: 'app-item-icon',
  template: `
    @if (imgSrc(); as src) {
      <img class="item-icon-img" [src]="src" (error)="onError()" alt="" />
    } @else {
      <svg
        class="item-icon"
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
        width: 18px;
        height: 18px;
        color: #999;
        flex-shrink: 0;
      }
      .item-icon-img {
        width: 18px;
        height: 18px;
        object-fit: contain;
        border-radius: 3px;
        flex-shrink: 0;
      }
    `,
  ],
})
export class ItemIconComponent {
  readonly name = input.required<string>();

  private readonly errored = signal(false);

  protected readonly imgSrc = computed(() => {
    if (this.errored()) return null;
    const entry = WAKFU_ITEMS_FR[this.name().toLowerCase().trim()];
    return entry ? `${ITEM_IMAGE_BASE_URL}${entry.gfxId}.png` : null;
  });

  protected onError(): void {
    this.errored.set(true);
  }
}
