import { Component, computed, input, output } from '@angular/core';
import { TooltipDirective } from '../tooltip/tooltip.directive';

/**
 * Pas-à-pas numérique générique (‹ label › ) — ciblable au clavier comme un champ de saisie
 * (un seul tabstop, `role="spinbutton"` sur le conteneur, les deux boutons sortis du flux de
 * tabulation) : flèche gauche pour reculer, flèche droite pour avancer, en plus du clic sur les
 * boutons. `label()` est le texte déjà mis en forme par l'appelant (traduction + interpolation
 * faites en amont, ex. `'damageMeter.turnLabel' | t: { n: turn() }`) — ce composant ne connaît
 * rien à l'i18n, seulement à la valeur numérique et à ses bornes.
 *
 * Remplace l'ancien bloc `.damage-turn-stepper` local à `DamageViewSwitchComponent` — à réutiliser
 * pour tout futur pas-à-pas numérique plutôt qu'un nouveau copier-coller HTML+CSS+JS (voir
 * CLAUDE.md, section "Toujours composant, jamais bloc local").
 */
@Component({
  selector: 'app-stepper',
  imports: [TooltipDirective],
  templateUrl: './stepper.component.html',
  styleUrl: './stepper.component.css',
})
export class StepperComponent {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly min = input(1);
  readonly max = input.required<number>();
  /** Pas appliqué à chaque avance/recul (flèche clavier ou clic bouton) — 1 par défaut. */
  readonly step = input(1);
  readonly prevTooltip = input<string | null>(null);
  readonly nextTooltip = input<string | null>(null);

  /** Émis déjà borné à [min(), max()] — l'appelant n'a pas besoin de re-clamper. */
  readonly valueChange = output<number>();

  protected readonly canDecrement = computed(() => this.value() > this.min());
  protected readonly canIncrement = computed(() => this.value() < this.max());

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.move(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.move(1);
    }
  }

  protected move(direction: -1 | 1): void {
    const next = Math.min(this.max(), Math.max(this.min(), this.value() + direction * this.step()));
    if (next !== this.value()) this.valueChange.emit(next);
  }
}
