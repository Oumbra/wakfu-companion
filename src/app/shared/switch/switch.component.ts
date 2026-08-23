import { Component, input, output } from '@angular/core';

/**
 * Interrupteur booléen générique (pilule on/off) — composant contrôlé, même principe que
 * `app-stepper`/`app-input-number` : l'appelant reste responsable de persister la valeur via
 * `(checkedChange)`. Introduit pour le découpage de l'historique du composeur de disposition du
 * tableau de bord (`DashboardLayoutPickerComponent`), mais générique — à réutiliser pour tout futur
 * réglage booléen plutôt qu'un nouveau bloc `<button>` + CSS local (voir CLAUDE.md, section
 * "Toujours un composant, jamais un bloc local").
 */
@Component({
  selector: 'app-switch',
  templateUrl: './switch.component.html',
  styleUrl: './switch.component.css',
})
export class SwitchComponent {
  readonly checked = input.required<boolean>();
  readonly disabled = input(false);
  readonly checkedChange = output<boolean>();

  protected toggle(): void {
    if (this.disabled()) return;
    this.checkedChange.emit(!this.checked());
  }
}
