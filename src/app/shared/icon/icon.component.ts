import { Component, input } from '@angular/core';

/**
 * SVG utilitaires partagés, servis via le sprite public/assets/icons-*.svg (voir
 * icon.component.html) — nom hashé pour un cache navigateur immuable, à régénérer
 * si le contenu du sprite change. `strokeWidth` reste paramétrable : deux appelants
 * du même pictogramme utilisaient parfois une épaisseur de trait légèrement
 * différente (ex. `chevron-left`, 2 vs 2.2), une vraie petite spécificité à
 * préserver plutôt qu'à écraser.
 */
export type AppIconName =
  | 'clock'
  | 'clock-long'
  | 'reset'
  | 'check'
  | 'chevron-left'
  | 'edit'
  | 'volume-on'
  | 'volume-off'
  | 'calendar'
  | 'map-pin'
  | 'swords'
  | 'trending-up'
  | 'target'
  | 'messages-square'
  | 'crossed-swords'
  | 'shopping-bag'
  | 'arrows-exchange'
  | 'scroll'
  | 'help-circle';

/** Nom de fichier du sprite — seul endroit à modifier si le sprite est régénéré. */
export const ICONS_SPRITE_URL = 'assets/icons-38a6de23.svg';

@Component({
  selector: 'app-icon',
  templateUrl: './icon.component.html',
  styleUrl: './icon.component.css',
})
export class IconComponent {
  readonly name = input.required<AppIconName>();
  readonly strokeWidth = input(1.8);
  /** Taille en px (carrée) — l'ancienne mise en forme `.xxx svg { width; height }` de chaque
   * appelant ne peut pas atteindre ce `<svg>` : l'encapsulation de vue Angular scope les
   * sélecteurs CSS au template qui les déclare, et ce `<svg>` appartient au template de CE
   * composant, pas à celui de l'appelant (même avec `:host{display:contents}`, qui ne change que
   * la boîte du hôte, pas la portée des sélecteurs). D'où un `@Input` explicite plutôt qu'une
   * classe CSS passée par l'appelant. */
  readonly size = input(20);

  protected readonly spriteUrl = ICONS_SPRITE_URL;
}
