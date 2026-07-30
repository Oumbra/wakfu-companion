import { Injectable, signal } from '@angular/core';

export interface ConfirmDeleteRequest {
  message: string;
  /** Distance (px) au bord droit du viewport — la popover s'affiche alignée à droite de `anchor`. */
  right: number;
  top: number;
  onConfirm: () => void;
}

/**
 * Point d'entrée unique pour la popover de confirmation de suppression
 * (KPI de suivi, personnages du profil...). Rendue une seule fois au niveau
 * racine (`app.html`), hors de tout ancêtre `transform` (`.view-slider`) —
 * même raison que `ClassPickerService`, voir son commentaire.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmDeleteService {
  readonly request = signal<ConfirmDeleteRequest | null>(null);

  /** `anchor` : élément déclencheur (ex. le bouton ×), la popover s'affiche en dessous, alignée sur sa droite. */
  open(anchor: HTMLElement, message: string, onConfirm: () => void): void {
    const rect = anchor.getBoundingClientRect();
    const gap = 6;
    this.request.set({
      message,
      right: window.innerWidth - rect.right,
      top: rect.bottom + gap,
      onConfirm,
    });
  }

  close(): void {
    this.request.set(null);
  }
}
