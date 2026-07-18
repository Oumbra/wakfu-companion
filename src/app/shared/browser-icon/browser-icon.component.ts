import { Component, input } from '@angular/core';

export type BrowserKind = 'chrome' | 'edge' | 'opera';

const BROWSER_COLORS: Record<BrowserKind, string> = {
  chrome: 'linear-gradient(135deg, #ea4335, #fbbc05, #34a853, #4285f4)',
  edge: 'linear-gradient(135deg, #0c59a4, #10893e, #37c4b3)',
  opera: 'linear-gradient(135deg, #ff1b2d, #a70017)',
};

const BROWSER_LETTERS: Record<BrowserKind, string> = {
  chrome: 'C',
  edge: 'E',
  opera: 'O',
};

/**
 * Badge simplifié (dégradé + initiale) pour lister les navigateurs
 * compatibles avec l'API de lecture continue — pas une reproduction des
 * logos officiels (marques déposées), juste un repère visuel + le nom
 * affiché à côté suffit pour identifier le navigateur.
 */
@Component({
  selector: 'app-browser-icon',
  template: `<span class="browser-badge" [style.background]="gradient()">{{ letter() }}</span>`,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .browser-badge {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-weight: 800;
        font-size: 0.8em;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
      }
    `,
  ],
})
export class BrowserIconComponent {
  readonly kind = input.required<BrowserKind>();

  protected gradient(): string {
    return BROWSER_COLORS[this.kind()];
  }

  protected letter(): string {
    return BROWSER_LETTERS[this.kind()];
  }
}
