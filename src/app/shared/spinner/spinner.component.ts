import { Component, input } from '@angular/core';

/**
 * Anneau de chargement générique (couleur `--accent`, un quart transparent qui tourne) — extrait de
 * `LoadingOverlayComponent` (voir CLAUDE.md, "toujours un composant, jamais un bloc recopié")
 * puisqu'il doit désormais apparaître ailleurs qu'en plein écran (ex. `FightHistoryComponent`
 * pendant l'interprétation initiale du fichier, `HistoryComponent` pendant un "Charger plus") sans
 * le fond opaque ni le blocage d'interaction de l'overlay. `[size]`/`[borderWidth]` permettent
 * d'ajuster le gabarit par appelant plutôt que de figer une seule taille — `LoadingOverlayComponent`
 * passe explicitement 48/4 pour conserver son rendu d'origine à l'identique.
 */
@Component({
  selector: 'app-spinner',
  templateUrl: './spinner.component.html',
  styleUrl: './spinner.component.css',
})
export class SpinnerComponent {
  readonly size = input(32);
  readonly borderWidth = input(3);
}
