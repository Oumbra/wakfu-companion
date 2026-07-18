import { Component, input } from '@angular/core';

export type FlagCountry = 'fr' | 'gb' | 'es' | 'pt';

/**
 * Drapeaux dessinés en SVG inline (pas de fichier externe) : nécessaire pour
 * que le build standalone (un seul fichier HTML, voir tools/build-standalone.mjs)
 * fonctionne sans image manquante, et pour éviter la dépendance flag-icons dont
 * les centaines de SVG référencés en CSS provoquaient des collisions de build
 * esbuild sur Windows. Tracés simplifiés (sans blason détaillé) : largement
 * suffisant à la taille d'affichage (~20px).
 */
@Component({
  selector: 'app-flag-icon',
  template: `
    <svg viewBox="0 0 4 3" xmlns="http://www.w3.org/2000/svg" [attr.aria-label]="country()">
      @switch (country()) {
        @case ('fr') {
          <rect width="4" height="3" fill="#fff" />
          <rect width="1.33" height="3" fill="#002654" />
          <rect x="2.67" width="1.33" height="3" fill="#ed2939" />
        }
        @case ('gb') {
          <rect width="4" height="3" fill="#012169" />
          <path d="M0,0 L4,3 M4,0 L0,3" stroke="#fff" stroke-width="0.6" />
          <path d="M0,0 L4,3 M4,0 L0,3" stroke="#c8102e" stroke-width="0.24" />
          <path d="M2,0 V3 M0,1.5 H4" stroke="#fff" stroke-width="0.9" />
          <path d="M2,0 V3 M0,1.5 H4" stroke="#c8102e" stroke-width="0.5" />
        }
        @case ('es') {
          <rect width="4" height="3" fill="#aa151b" />
          <rect y="0.75" width="4" height="1.5" fill="#f1bf00" />
        }
        @case ('pt') {
          <rect width="4" height="3" fill="#ff0000" />
          <rect width="1.6" height="3" fill="#046a38" />
        }
      }
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        flex-shrink: 0;
      }
      svg {
        width: 100%;
        height: 100%;
        border-radius: 2px;
      }
    `,
  ],
})
export class FlagIconComponent {
  readonly country = input.required<FlagCountry>();
}
