import { Component, input, output } from '@angular/core';
import { TranslatePipe } from '../translate.pipe';
import { StepperComponent } from '../stepper/stepper.component';

export type DamageViewMode = 'total' | 'turn';

/**
 * Switch "Cumulé"/"Tour" affiché au-dessus d'une paire de listes alliés/ennemis
 * (voir EntityDamageListComponent) — un seul exemplaire pilote les deux listes
 * d'un même combat, jamais un par liste (la notion de tour est celle du
 * combat, pas d'un camp). Le pas à pas de tour (‹ Tour N ›) n'apparaît qu'en
 * mode 'turn'. Réutilisé par CombatDetailComponent (combat en cours ET combat de l'historique,
 * voir FightHistoryComponent) plutôt que dupliqué : même règle que les autres panneaux d'outils
 * (voir CLAUDE.md). `mode: 'total'` reste l'identifiant interne (type `DamageViewMode`) même si le
 * libellé affiché est désormais "Cumulé" partout (voir `totalLabelKey`) — seul le texte a changé,
 * pas la valeur du signal/état.
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
  /** Clé i18n du libellé du bouton "Cumulé" — même texte pour le combat en cours ET l'historique
   * (voir CLAUDE.md), input laissé overridable au cas où un futur appelant en aurait besoin. Par
   * défaut 'damageMeter.viewCumulative'. */
  readonly totalLabelKey = input<string>('damageMeter.viewCumulative');

  readonly modeChange = output<DamageViewMode>();
  /** Émis déjà borné à [1, maxTurn()] — l'appelant n'a pas besoin de re-clamper. */
  readonly turnChange = output<number>();

  protected setMode(mode: DamageViewMode): void {
    if (mode !== this.mode()) this.modeChange.emit(mode);
  }
}
