import { Component, input, output } from '@angular/core';
import { TranslatePipe } from '../translate.pipe';
import { StepperComponent } from '../stepper/stepper.component';

export type DamageViewMode = 'total' | 'turn';

/**
 * Switch "Total"/"Tour" affiché au-dessus d'une paire de listes alliés/ennemis
 * (voir EntityDamageListComponent) — un seul exemplaire pilote les deux listes
 * d'un même combat, jamais un par liste (la notion de tour est celle du
 * combat, pas d'un camp). Le pas à pas de tour (‹ Tour N ›) n'apparaît qu'en
 * mode 'turn'. Réutilisé par DamageMeterComponent (combat en cours) et
 * FightHistoryComponent (un combat de l'historique) plutôt que dupliqué :
 * même règle que les autres panneaux d'outils (voir CLAUDE.md).
 */
@Component({
  selector: 'app-damage-view-switch',
  imports: [TranslatePipe, StepperComponent],
  templateUrl: './damage-view-switch.component.html',
  styleUrl: './damage-view-switch.component.css',
})
export class DamageViewSwitchComponent {
  readonly mode = input.required<DamageViewMode>();
  /** Tour actuellement sélectionné (1-based) — ignoré tant que `mode()` vaut `'total'`. */
  readonly turn = input.required<number>();
  /** Dernier tour disponible pour ce combat (voir Fight.turnCount/FightRecord.turns) — borne haute
   * du pas à pas, toujours >= 1. */
  readonly maxTurn = input.required<number>();

  readonly modeChange = output<DamageViewMode>();
  /** Émis déjà borné à [1, maxTurn()] — l'appelant n'a pas besoin de re-clamper. */
  readonly turnChange = output<number>();

  protected setMode(mode: DamageViewMode): void {
    if (mode !== this.mode()) this.modeChange.emit(mode);
  }
}
