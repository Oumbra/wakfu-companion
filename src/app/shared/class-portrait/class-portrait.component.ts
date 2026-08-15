import { Component, computed, input } from '@angular/core';
import { Gender } from '../../core/data/class-icons.data';
import {
  CLASS_PORTRAITS_SPRITE_COLS,
  CLASS_PORTRAITS_SPRITE_ROWS,
  CLASS_PORTRAITS_SPRITE_URI,
  getClassPortraitRow,
} from '../../core/data/class-portraits.data';

const LAST_ROW = CLASS_PORTRAITS_SPRITE_ROWS - 1;
const LAST_COL = CLASS_PORTRAITS_SPRITE_COLS - 1;

/**
 * Portrait "grand format" d'une classe (planche Ankama, voir class-portraits.data.ts) : deux
 * calques superposés (mat en dessous, coloré au-dessus à `opacity: 0`) plutôt qu'un unique calque
 * dont on décalerait `background-position` au survol — un décalage animé aurait fait "glisser"
 * visuellement une illustration vers l'autre (les 2 versions sont côte à côte dans la planche),
 * alors qu'un fondu d'opacité donne un vrai crossfade sur place, fidèle au rendu du site officiel.
 * `:host(:hover)` suffit : le survol de n'importe quel descendant (donc du bouton appelant qui
 * remplit tout l'espace) déclenche aussi `:hover` sur cet hôte (l'état se propage aux ancêtres).
 * Positionnement en pourcentage (comme AvatarIconComponent) : reste net à la taille demandée par
 * l'appelant, quelle qu'elle soit.
 */
@Component({
  selector: 'app-class-portrait',
  host: {
    // Aperçu figé (ex. `.avatar-preview`, la case déjà choisie) plutôt qu'une tuile à survoler
    // parmi d'autres (grille de choix, ClassPicker) : toujours affiché en couleur, comme une vraie
    // photo de profil plutôt qu'une invite "survolez-moi".
    '[class.always-colored]': 'alwaysColored()',
  },
  // \`background-image\` posé via un binding plutôt qu'en dur dans \`styles\` ci-dessous (même
  // technique qu'AvatarIconComponent) : un \`url(...)\` littéral dans les styles inline serait
  // traité comme une ressource CSS à résoudre AU BUILD par esbuild (plugin angular-css-resource),
  // qui échoue puisque ce chemin est une ressource PUBLIQUE servie au runtime (public/assets/...),
  // pas un module importable — erreur réelle rencontrée en session ("Could not resolve...").
  template: `
    <div class="class-portrait-layer class-portrait-muted" [style.background-image]="bgImage" [style.background-position]="mutedPosition()"></div>
    <div class="class-portrait-layer class-portrait-colored" [style.background-image]="bgImage" [style.background-position]="coloredPosition()"></div>
  `,
  styles: [
    `
      :host {
        display: inline-block;
        position: relative;
        overflow: hidden;
      }
      .class-portrait-layer {
        position: absolute;
        inset: 0;
        background-size: ${CLASS_PORTRAITS_SPRITE_COLS * 100}% ${CLASS_PORTRAITS_SPRITE_ROWS * 100}%;
        background-repeat: no-repeat;
      }
      .class-portrait-colored {
        opacity: 0;
        transition: opacity 0.18s ease;
      }
      :host(:hover) .class-portrait-colored,
      :host(.always-colored) .class-portrait-colored {
        opacity: 1;
      }
    `,
  ],
})
export class ClassPortraitComponent {
  readonly className = input<string | undefined>(undefined);
  readonly gender = input<Gender>('m');
  readonly alwaysColored = input(false);

  protected readonly bgImage = `url(${CLASS_PORTRAITS_SPRITE_URI})`;
  /** Planche 4 colonnes : [mâle coloré, mâle mat, femelle coloré, femelle mat] — voir
   * class-portraits.data.ts. */
  protected readonly mutedPosition = computed(() => this.positionFor(this.gender() === 'm' ? 1 : 3));
  protected readonly coloredPosition = computed(() => this.positionFor(this.gender() === 'm' ? 0 : 2));

  private positionFor(col: number): string {
    const row = getClassPortraitRow(this.className());
    const x = (col / LAST_COL) * 100;
    const y = (row / LAST_ROW) * 100;
    return `${x}% ${y}%`;
  }
}
