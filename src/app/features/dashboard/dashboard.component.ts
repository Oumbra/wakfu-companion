import { Component, computed, effect, inject, signal } from '@angular/core';
import { DamageMeterComponent } from '../damage-meter/damage-meter.component';
import { ChatPanelComponent } from '../chat-panel/chat-panel.component';
import { TrackerComponent } from '../tracker/tracker.component';
import { TrackerStripComponent } from '../tracker-strip/tracker-strip.component';
import { HistoryComponent } from '../history/history.component';
import { CombatPanelService } from '../../core/services/combat-panel.service';
import { TranslatePipe } from '../../shared/translate.pipe';
import { HelpModalService } from '../../core/services/help-modal.service';

type DashboardTab = 'damage' | 'tracker' | 'history' | 'chat';

/** En dessous du breakpoint mobile (voir dashboard.component.css), les
 * panneaux ne sont plus affichés en même temps mais sélectionnés via onglets
 * — chacun reste monté en permanence (juste masqué en CSS) pour conserver
 * son état (scroll, filtres...) d'un onglet à l'autre. L'onglet Combat
 * n'apparaît (mobile) / la colonne Combat n'est ajoutée à la grille
 * (desktop) que lorsqu'un combat est en cours (voir CombatPanelService). */
@Component({
  selector: 'app-dashboard',
  imports: [
    DamageMeterComponent,
    TrackerComponent,
    TrackerStripComponent,
    HistoryComponent,
    ChatPanelComponent,
    TranslatePipe,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  protected readonly combatPanel = inject(CombatPanelService);
  protected readonly helpModal = inject(HelpModalService);

  protected readonly activeTab = signal<DashboardTab>('tracker');

  /** Ordre des onglets réellement affichés (mobile) : Combat n'y figure que
   * pendant un combat en cours (voir CombatPanelService.hasActiveFight). */
  private readonly visibleTabOrder = computed<DashboardTab[]>(() =>
    this.combatPanel.hasActiveFight()
      ? ['damage', 'tracker', 'history', 'chat']
      : ['tracker', 'history', 'chat'],
  );
  protected readonly tabCount = computed(() => this.visibleTabOrder().length);
  /** Index de l'onglet actif parmi ceux réellement visibles (voir `.tab-slider` en CSS, qui glisse selon cet index). */
  protected readonly activeTabIndex = computed(() => {
    const index = this.visibleTabOrder().indexOf(this.activeTab());
    return index === -1 ? 0 : index;
  });

  constructor() {
    // Le combat vient de se terminer pendant que l'onglet Combat (mobile)
    // était actif : son bouton disparaît de la barre, on bascule sur Suivi
    // plutôt que de laisser l'utilisateur sur un onglet fantôme.
    effect(() => {
      if (!this.combatPanel.hasActiveFight() && this.activeTab() === 'damage') {
        this.activeTab.set('tracker');
      }
    });
  }
}
