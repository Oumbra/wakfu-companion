import { Injectable, signal } from '@angular/core';
import { PeriodGranularity } from '../utils/local-period.util';

export interface PeriodPickerRequest {
  granularity: PeriodGranularity;
  /** `periodOffset` couramment affiché (0 = période en cours) — sert à présélectionner la bonne
   * page/cellule à l'ouverture. */
  currentOffset: number;
  /** Borne basse en pas d'offset (voir `OFFSET_MIN`, `SessionRecapComponent`) — toute cellule dont
   * la période serait antérieure à cette borne est désactivée, jamais masquée. */
  min: number;
  x: number;
  y: number;
  onPick: (offset: number) => void;
}

/**
 * Point d'entrée unique pour ouvrir le mini calendrier de navigation de période (icône 📅 à côté
 * du stepper ‹ › de `SessionRecapComponent`). Rendu une seule fois au niveau racine (`app.html`),
 * en dehors de tout ancêtre `transform` — même principe et même raison que `ClassPickerService`
 * (voir sa doc de tête) : un `<app-period-picker>` niché dans un ancêtre `transform` (ex.
 * `.recap-panel` centré) verrait son `position: fixed` recalculé relativement à cet ancêtre plutôt
 * qu'au viewport.
 */
@Injectable({ providedIn: 'root' })
export class PeriodPickerService {
  readonly request = signal<PeriodPickerRequest | null>(null);

  open(
    granularity: PeriodGranularity,
    currentOffset: number,
    min: number,
    x: number,
    y: number,
    onPick: (offset: number) => void,
  ): void {
    this.request.set({ granularity, currentOffset, min, x, y, onPick });
  }

  close(): void {
    this.request.set(null);
  }
}
