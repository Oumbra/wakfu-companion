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
 * Portrait "grand format" d'une classe (planche `class-avatars-sheet-*.png`, 2 colonnes
 * [féminin, masculin] x 18 lignes — voir class-portraits.data.ts). Contrairement à l'ancienne
 * planche (4 colonnes, une variante mate ET une colorée pré-rendues par case), cette planche ne
 * fournit qu'UNE seule image par sexe : l'effet "mat au repos, coloré au survol" est donc
 * reproduit ici par un filtre CSS (`grayscale`/`brightness`) sur l'unique calque plutôt que par un
 * crossfade entre deux images — rendu légèrement différent de l'ancienne planche, faute de
 * variante mate fournie pour ces images.
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
  // `background-image` posé via un binding plutôt qu'en dur dans `styles` ci-dessous (même
  // technique qu'AvatarIconComponent) : un `url(...)` littéral dans les styles inline serait
  // traité comme une ressource CSS à résoudre AU BUILD par esbuild (plugin angular-css-resource),
  // qui échoue puisque ce chemin est une ressource PUBLIQUE servie au runtime (public/assets/...),
  // pas un module importable — erreur réelle rencontrée en session ("Could not resolve...").
  template: `
    <div class="class-portrait-layer" [style.background-image]="bgImage" [style.background-position]="position()"></div>
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
        filter: grayscale(0.85) brightness(0.75) saturate(0.5);
        transition: filter 0.18s ease;
      }
      :host(:hover) .class-portrait-layer,
      :host(.always-colored) .class-portrait-layer {
        filter: none;
      }
    `,
  ],
})
export class ClassPortraitComponent {
  readonly className = input<string | undefined>(undefined);
  readonly gender = input<Gender>('m');
  readonly alwaysColored = input(false);

  protected readonly bgImage = `url(${CLASS_PORTRAITS_SPRITE_URI})`;
  /** Planche 2 colonnes : [féminin, masculin] — voir class-portraits.data.ts. */
  protected readonly position = computed(() => this.positionFor(this.gender() === 'f' ? 0 : 1));

  private positionFor(col: number): string {
    const row = getClassPortraitRow(this.className());
    const x = (col / LAST_COL) * 100;
    const y = (row / LAST_ROW) * 100;
    return `${x}% ${y}%`;
  }
}
