import { Component, computed, input } from '@angular/core';
import {
  CLASS_PORTRAITS_SPRITE_COLS,
  CLASS_PORTRAITS_SPRITE_ROWS,
  CLASS_PORTRAITS_SPRITE_URI,
} from '../../core/data/class-portraits.data';

const LAST_INDEX = CLASS_PORTRAITS_SPRITE_COLS * CLASS_PORTRAITS_SPRITE_ROWS - 1;

/**
 * Une case de la planche de portraits "grand format" (18 classes x 2 sexes, voir
 * class-portraits.data.ts) — même planche que `app-class-portrait`, mais sans l'effet de survol
 * mat/coloré (petit badge toujours affiché en couleur, pas une tuile de choix). Positionnement en
 * pourcentage (pas en px) pour rester net quel que soit l'agrandissement demandé par l'appelant
 * (taille fixée via CSS sur le host).
 */
@Component({
  selector: 'app-avatar-icon',
  // La planche est liée dynamiquement (import depuis class-portraits.data.ts, servie en fichier
  // statique hashé sous public/assets/avatars/) plutôt que mise en dur dans `styles`.
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
        background-size: ${CLASS_PORTRAITS_SPRITE_COLS * 100}% ${CLASS_PORTRAITS_SPRITE_ROWS * 100}%;
        background-repeat: no-repeat;
      }
    `,
  ],
})
export class AvatarIconComponent {
  /** Index 0-35 dans AVATAR_GRID_ENTRIES (voir class-portraits.data.ts, `getAvatarGridIndex`) :
   * rangée = classe (CLASS_PORTRAIT_ORDER), colonne = sexe (0 = féminin, 1 = masculin). */
  readonly index = input.required<number>();

  protected readonly bgImage = `url(${CLASS_PORTRAITS_SPRITE_URI})`;

  protected readonly bgPosition = computed(() => {
    const i = Math.max(0, Math.min(LAST_INDEX, Math.round(this.index())));
    const col = i % CLASS_PORTRAITS_SPRITE_COLS;
    const row = Math.floor(i / CLASS_PORTRAITS_SPRITE_COLS);
    const x = (col / (CLASS_PORTRAITS_SPRITE_COLS - 1)) * 100;
    const y = (row / (CLASS_PORTRAITS_SPRITE_ROWS - 1)) * 100;
    return `${x}% ${y}%`;
  });
}
