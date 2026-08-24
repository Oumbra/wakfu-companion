import { Component, computed, inject } from '@angular/core';
import { ChatPanelComponent } from '../chat-panel/chat-panel.component';
import { TrackerComponent } from '../tracker/tracker.component';
import { TrackerStripComponent } from '../tracker-strip/tracker-strip.component';
import { HistoryComponent } from '../history/history.component';
import { DashboardRailComponent } from '../dashboard-rail/dashboard-rail.component';
import { ChatPanelService } from '../../core/services/chat-panel.service';
import { HelpSection } from '../../core/services/help-modal.service';
import { TabBarComponent, TabBarItem } from '../../shared/tab-bar/tab-bar.component';
import { DashboardTab, NavigationService } from '../../core/services/navigation.service';
import { DashboardLayoutService } from '../../core/services/dashboard-layout.service';

/** En dessous du breakpoint mobile (voir dashboard.component.css), les
 * panneaux ne sont plus affichés en même temps mais sélectionnés via onglets
 * — chacun reste monté en permanence (juste masqué en CSS) pour conserver
 * son état (scroll, filtres...) d'un onglet à l'autre. Combat n'a plus
 * d'onglet dédié (voir CLAUDE.md, fusion avec l'historique) : son contenu vit
 * désormais dans l'onglet Historique (sous-onglet Combats, voir
 * FightHistoryComponent) — la barre d'onglets mobile est donc fixe.
 *
 * Desktop uniquement, Historique ET Chat sont aussi repliables individuellement
 * (voir DashboardLayoutService/ChatPanelService) — une section repliée rejoint le
 * menu latéral `<app-dashboard-rail>` (voir DashboardRailComponent) plutôt que
 * de disparaître purement et simplement. Chat reste monté en permanence même
 * replié (repli géré en CSS via `.panel-collapsed`, voir dashboard.component.css). */
@Component({
  selector: 'app-dashboard',
  imports: [
    TrackerComponent,
    TrackerStripComponent,
    HistoryComponent,
    ChatPanelComponent,
    DashboardRailComponent,
    TabBarComponent,
  ],
  // Position du menu (voir DashboardLayoutService/dashboard.component.css) : attribut plutôt que
  // plusieurs `[class.x]` — un seul point de lecture pour tout le CSS de positionnement,
  // `top-left`/`top-right` partagent la même disposition ici (seul l'alignement interne des icônes
  // du rail diffère, voir DashboardRailComponent).
  host: {
    '[attr.data-menu-pos]': 'layout.menuPos()',
    '(document:keydown)': 'onStreamerHotkey($event)',
  },
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  protected readonly chatPanel = inject(ChatPanelService);
  protected readonly layout = inject(DashboardLayoutService);
  private readonly nav = inject(NavigationService);

  /** Alias vers `NavigationService.dashboardTab` (source unique de vérité, voir son commentaire —
   * synchronisée avec l'URL) plutôt qu'un signal local : `.set()` ici met donc directement à jour
   * la section active ET déclenche `RouteSyncService`. */
  protected readonly activeTab = this.nav.dashboardTab;

  private static readonly TAB_LABELS: Record<DashboardTab, string> = {
    tracker: 'tracker.header',
    history: 'history.header',
    chat: 'chat.header',
  };
  /** Seuls Suivi et Chat portent une icône d'aide sur l'onglet : Historique a déjà la sienne dans
   * l'en-tête de son propre panneau (voir history component). */
  private static readonly TAB_HELP: Partial<Record<DashboardTab, HelpSection>> = {
    tracker: 'tracker',
    chat: 'chat',
  };

  private static readonly TAB_ORDER: readonly DashboardTab[] = ['tracker', 'history', 'chat'];
  /** Items passés à `<app-tab-bar>` (voir TabBarComponent) — labels en clés i18n, résolues par le
   * composant lui-même. */
  protected readonly tabItems = computed<TabBarItem[]>(() =>
    DashboardComponent.TAB_ORDER.map((id) => ({
      id,
      label: DashboardComponent.TAB_LABELS[id],
      helpSection: DashboardComponent.TAB_HELP[id],
    })),
  );

  protected selectTab(id: string): void {
    this.activeTab.set(id as DashboardTab);
  }

  /** Ctrl+Shift+Alt+S : bascule `data-streamer` sur `<html>` (mode "streamer", ex. masquage de
   * contenu sensible via CSS ciblant cet attribut) — écouté sur `document` plutôt que l'hôte pour
   * fonctionner même si le focus est ailleurs dans la page (aucun input texte concerné par cette
   * combinaison). */
  protected onStreamerHotkey(event: KeyboardEvent): void {
    if (!event.ctrlKey || !event.shiftKey || !event.altKey) return;
    if (event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    const html = document.documentElement;
    html.setAttribute('data-streamer', html.getAttribute('data-streamer') === 'on' ? 'off' : 'on');
  }
}
