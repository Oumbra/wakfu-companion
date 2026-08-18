import { Component, computed, effect, inject } from '@angular/core';
import { DamageMeterComponent } from '../damage-meter/damage-meter.component';
import { ChatPanelComponent } from '../chat-panel/chat-panel.component';
import { TrackerComponent } from '../tracker/tracker.component';
import { TrackerStripComponent } from '../tracker-strip/tracker-strip.component';
import { HistoryComponent } from '../history/history.component';
import { CombatPanelService } from '../../core/services/combat-panel.service';
import { HelpSection } from '../../core/services/help-modal.service';
import { TabBarComponent, TabBarItem } from '../../shared/tab-bar/tab-bar.component';
import { DashboardTab, NavigationService } from '../../core/services/navigation.service';

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
    TabBarComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  protected readonly combatPanel = inject(CombatPanelService);
  private readonly nav = inject(NavigationService);

  /** Alias vers `NavigationService.dashboardTab` (source unique de vérité, voir son commentaire —
   * synchronisée avec l'URL) plutôt qu'un signal local : `.set()` ici met donc directement à jour
   * la section active ET déclenche `RouteSyncService`. */
  protected readonly activeTab = this.nav.dashboardTab;

  private static readonly TAB_LABELS: Record<DashboardTab, string> = {
    damage: 'damageMeter.header',
    tracker: 'tracker.header',
    history: 'history.header',
    chat: 'chat.header',
  };
  /** Seuls Suivi et Chat portent une icône d'aide sur l'onglet : Combat et Historique ont déjà la
   * leur dans l'en-tête de leur propre panneau (voir damage-meter/history component). */
  private static readonly TAB_HELP: Partial<Record<DashboardTab, HelpSection>> = {
    tracker: 'tracker',
    chat: 'chat',
  };

  /** Ordre des onglets réellement affichés (mobile) : Combat n'y figure que
   * pendant un combat en cours (voir CombatPanelService.hasActiveFight). */
  private readonly visibleTabOrder = computed<DashboardTab[]>(() =>
    this.combatPanel.hasActiveFight()
      ? ['damage', 'tracker', 'history', 'chat']
      : ['tracker', 'history', 'chat'],
  );
  /** Items passés à `<app-tab-bar>` (voir TabBarComponent) — labels en clés i18n, résolues par le
   * composant lui-même. */
  protected readonly tabItems = computed<TabBarItem[]>(() =>
    this.visibleTabOrder().map((id) => ({
      id,
      label: DashboardComponent.TAB_LABELS[id],
      helpSection: DashboardComponent.TAB_HELP[id],
    })),
  );

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

  protected selectTab(id: string): void {
    this.activeTab.set(id as DashboardTab);
  }
}
