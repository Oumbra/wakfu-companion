import { Injectable, signal } from '@angular/core';
import { Gender } from '../data/class-icons.data';
import { MediaQuerySignal } from '../utils/media-query-signal';

export type ClassPickerMode = 'icons' | 'portraits';

export interface ClassPickerRequest {
  name: string | null;
  x: number;
  y: number;
  initialMode: ClassPickerMode;
  switchModeBlocked: boolean;
  onChosen: (className: string, gender: Gender) => void;
}

/**
 * Point d'entrée unique pour ouvrir le sélecteur de classe (clic droit sur un
 * allié dont la classe a été mal détectée/à redéfinir). Rendu une seule fois
 * au niveau racine (`app.html`), en dehors de tout ancêtre `transform`
 * (`.recap-panel` centré, `.view-slider`...) : un `<app-class-picker>` niché
 * dans un tel ancêtre voit son `position: fixed` recalculé relativement à cet
 * ancêtre plutôt qu'au viewport (containing block créé par `transform`même
 * identité), causant un décalage important entre le clic et le menu affiché.
 */
@Injectable({ providedIn: 'root' })
export class ClassPickerService {
  readonly request = signal<ClassPickerRequest | null>(null);

  private readonly isMobile = new MediaQuerySignal('(max-width: 800px)');

  /** `initialMode` : mode d'affichage à l'ouverture ('icons' par défaut, comme avant) — l'utilisateur
   * peut ensuite basculer librement via le switch du picker, voir ClassPickerComponent. */
  open(
    name: string | null,
    x: number,
    y: number,
    onChosen: (className: string, gender: Gender) => void,
    initialMode: ClassPickerMode = 'icons',
    switchModeBlocked: boolean = false,
  ): void {
    const isMobileMatches = this.isMobile.matches();
    this.request.set({
      name,
      x,
      y,
      initialMode: isMobileMatches ? 'icons' : initialMode,
      switchModeBlocked: isMobileMatches || switchModeBlocked,
      onChosen,
    });
  }

  close(): void {
    this.request.set(null);
  }
}
