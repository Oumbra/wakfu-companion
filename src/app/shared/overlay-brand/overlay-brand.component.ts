import { Component } from '@angular/core';
import { APP_LOGO_PURPLE_DATA_URI } from '../../core/data/app-logo.data';

/**
 * Marque de l'overlay de bureau, sur une ligne : logo violet puis « Wakfu Companion » (même
 * typographie que le titre du header, `app-header.component.css`) suivi de « Overlay » en italique
 * atténué. Tout en HTML/CSS hormis le logo. Purement décorative — l'appelant porte le libellé
 * accessible de l'élément cliquable qui la contient.
 *
 * Taille ajustable depuis l'appelant via `--overlay-brand-font-size` posée sur la balise
 * `<app-overlay-brand>` (une règle du document l'emporte sur `:host`) ; le logo suit la police.
 */
@Component({
  selector: 'app-overlay-brand',
  templateUrl: './overlay-brand.component.html',
  styleUrl: './overlay-brand.component.css',
  host: { 'aria-hidden': 'true' },
})
export class OverlayBrandComponent {
  protected readonly logo = APP_LOGO_PURPLE_DATA_URI;
}
