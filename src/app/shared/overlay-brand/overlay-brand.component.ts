import { Component } from '@angular/core';
import { LARGE_APP_LOGO_PURPLE_DATA_URI } from '../../core/data/app-logo.data';

/**
 * Marque de l'overlay de bureau : logo violet surmontant le titre « Wakfu Companion Overlay »
 * (même typographie que le titre du header, `app-header.component.css`, suivie de « Overlay » en
 * italique atténué) et son badge « beta ». Purement décoratif — l'appelant porte le libellé
 * accessible de l'élément cliquable qui la contient.
 *
 * Tailles ajustables depuis l'appelant via `--overlay-brand-logo-size` et
 * `--overlay-brand-font-size` posées sur la balise `<app-overlay-brand>` (une règle du document
 * l'emporte sur `:host`, voir la bannière `app-overlay-announcement` en mobile).
 */
@Component({
  selector: 'app-overlay-brand',
  templateUrl: './overlay-brand.component.html',
  styleUrl: './overlay-brand.component.css',
  host: { 'aria-hidden': 'true' },
})
export class OverlayBrandComponent {
  protected readonly logo = LARGE_APP_LOGO_PURPLE_DATA_URI;
}
