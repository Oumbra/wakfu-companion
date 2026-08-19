import { Injectable, signal } from '@angular/core';

export interface OnboardingHelpMenuRequest {
  /** Distance (px) au bord droit du viewport — le menu s'affiche aligné à droite de l'ancre. */
  readonly right: number;
  readonly top: number;
}

/**
 * Popover « Aide » de l'en-tête (revoir tout le pas-à-pas / sauter à une fonctionnalité) — rendue
 * une seule fois au niveau racine (`app.html`), hors de tout ancêtre `transform`, même principe que
 * `ConfirmDeleteService`/`ClassPickerService` (voir leur commentaire et CLAUDE.md).
 */
@Injectable({ providedIn: 'root' })
export class OnboardingHelpMenuService {
  readonly request = signal<OnboardingHelpMenuRequest | null>(null);

  toggle(anchor: HTMLElement): void {
    if (this.request()) {
      this.close();
      return;
    }
    this.open(anchor);
  }

  open(anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const gap = 6;
    this.request.set({ right: window.innerWidth - rect.right, top: rect.bottom + gap });
  }

  close(): void {
    this.request.set(null);
  }
}
