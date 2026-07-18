import { Component } from '@angular/core';

/** Icône "tête de mort" partagée : signale une entité KO (liste de dégâts) ou une ligne de suivi comptant des mises KO. */
@Component({
  selector: 'app-ko-icon',
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path
        d="M5 11c0-4.4 3.4-7.5 7-7.5s7 3.1 7 7.5c0 2.5-1.2 4.6-3 6v2.3a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V17c-1.8-1.4-3-3.5-3-6z"
      />
      <circle cx="9.3" cy="11" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="11" r="1.2" fill="currentColor" stroke="none" />
      <path d="M9.5 18.7h5" />
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
      }
      svg {
        width: 15px;
        height: 15px;
      }
    `,
  ],
})
export class KoIconComponent {}
