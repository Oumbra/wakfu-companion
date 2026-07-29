import { Component, inject } from '@angular/core';
import { CombatPanelService } from '../../core/services/combat-panel.service';
import { TranslatePipe } from '../translate.pipe';
import { HEADER_ICON_COMBAT_DATA_URI } from '../../core/data/header-icons.data';

/**
 * Petit onglet collé au bord gauche de l'écran, visible quand le panneau
 * Combat est replié pendant un combat en cours (voir CombatPanelService).
 * Rendu une seule fois au niveau racine (`app.html`), en dehors de tout
 * ancêtre `transform` (`.view-slider`) — même raison que ClassPickerComponent
 * (voir CLAUDE.md et class-picker.service.ts) : niché plus profond, son
 * `position: fixed` se recalculerait relativement à cet ancêtre plutôt
 * qu'au viewport.
 */
@Component({
  selector: 'app-combat-edge-tab',
  imports: [TranslatePipe],
  templateUrl: './combat-edge-tab.component.html',
  styleUrl: './combat-edge-tab.component.css',
})
export class CombatEdgeTabComponent {
  protected readonly combatPanel = inject(CombatPanelService);
  protected readonly icon = HEADER_ICON_COMBAT_DATA_URI;

  protected expand(): void {
    this.combatPanel.setCollapsed(false);
  }
}
