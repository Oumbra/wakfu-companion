import { Component, computed, input } from '@angular/core';
import {
  BREEDS_SPRITE_COLS,
  BREEDS_SPRITE_DATA_URI,
  BREEDS_SPRITE_ROWS,
} from '../../core/data/class-breeds.data';

const LAST_INDEX = BREEDS_SPRITE_COLS * BREEDS_SPRITE_ROWS - 1;

/**
 * Une case (35x35 source) de la planche de portraits Ankama (18 classes x 2
 * sexes). Positionnement en pourcentage (pas en px) pour rester net quel que
 * soit l'agrandissement demandé par l'appelant (taille fixée via CSS sur le host).
 */
@Component({
  selector: 'app-avatar-icon',
  // La planche est liée dynamiquement (import depuis class-breeds.data.ts,
  // servie en fichier statique hashé sous public/assets/avatars/) plutôt que
  // mise en dur dans `styles`.
  template: `
    <div
      class="avatar-cell"
      [style.background-image]="bgImage"
      [style.background-position]="bgPosition()"
    ></div>
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }
      .avatar-cell {
        width: 100%;
        height: 100%;
        background-size: ${BREEDS_SPRITE_COLS * 100}% ${BREEDS_SPRITE_ROWS * 100}%;
        background-repeat: no-repeat;
      }
    `,
  ],
})
export class AvatarIconComponent {
  /** Index 0-35 (rangée = sexe, colonne = classe) dans la planche. */
  readonly index = input.required<number>();

  protected readonly bgImage = `url(${BREEDS_SPRITE_DATA_URI})`;

  protected readonly bgPosition = computed(() => {
    const i = Math.max(0, Math.min(LAST_INDEX, Math.round(this.index())));
    const col = i % BREEDS_SPRITE_COLS;
    const row = Math.floor(i / BREEDS_SPRITE_COLS);
    const x = (col / (BREEDS_SPRITE_COLS - 1)) * 100;
    const y = (row / (BREEDS_SPRITE_ROWS - 1)) * 100;
    return `${x}% ${y}%`;
  });
}
