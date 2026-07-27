import { Injectable, signal } from '@angular/core';
import { Gender } from '../data/class-icons.data';

export interface ClassPickerRequest {
  name: string;
  x: number;
  y: number;
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

  open(name: string, x: number, y: number, onChosen: (className: string, gender: Gender) => void): void {
    this.request.set({ name, x, y, onChosen });
  }

  close(): void {
    this.request.set(null);
  }
}
