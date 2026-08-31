import { Component, computed, inject } from '@angular/core';
import { ChatPanelComponent } from '../chat-panel/chat-panel.component';
import { TrackerComponent } from '../tracker/tracker.component';
import { TrackerStripComponent } from '../tracker-strip/tracker-strip.component';
import { HistoryComponent } from '../history/history.component';
import { SessionRecapComponent } from '../session-recap/session-recap.component';
import { DashboardRailComponent } from '../dashboard-rail/dashboard-rail.component';
import { ChatPanelService } from '../../core/services/chat-panel.service';
import { HelpSection } from '../../core/services/help-modal.service';
import { AuthService } from '../../core/auth/auth.service';
import { TabBarComponent, TabBarItem } from '../../shared/tab-bar/tab-bar.component';
import { HistoryTab, NavigationService } from '../../core/services/navigation.service';
import {
  DashboardBodySlotKey,
  DashboardGridKey,
  DashboardLayoutService,
} from '../../core/services/dashboard-layout.service';
import { shortSlotLabelKey } from '../../core/services/dashboard-body-slot-label';

/** En dessous du breakpoint mobile (voir dashboard.component.css), les
 * panneaux ne sont plus affichés en même temps mais sélectionnés via onglets
 * — chacun reste monté en permanence (juste masqué en CSS) pour conserver
 * son état (scroll, filtres...) d'un onglet à l'autre.
 *
 * `tabItems`/`activeMobileTab` sont dynamiques, dérivés de `DashboardLayoutService.activeSlots`
 * (CLAUDE.md) : le regroupement Historique choisi sur Profil › Personnalisation s'applique
 * désormais aussi bien au placement de grille desktop qu'à la liste d'onglets mobile — un onglet par
 * carte (Combat/Achats/Échanges chacun séparément si non regroupés, un seul onglet groupé sinon).
 * Avant ce changement, la barre mobile était figée à 3 onglets (Suivi/Historique/Chat) et forçait
 * toujours un panneau Historique regroupé complet, quel que soit le réglage — Combat/Achats/Échanges
 * non regroupés devenaient alors injoignables en mobile, et Récap (carte indépendante depuis son
 * introduction) n'y était jamais accessible du tout (bug réel corrigé, voir CLAUDE.md).
 *
 * `'tracker'` (Suivi) reste un onglet fixe en tête, hors de `activeSlots` (qui l'exclut
 * délibérément, voir sa doc de tête) : toujours présent, jamais repliable. L'ORDRE des autres
 * onglets, en revanche, ne suit PAS `blockOrder` (personnalisable, contrairement au placement
 * desktop) — voir `MOBILE_TAB_ORDER`, fixe.
 *
 * Desktop uniquement, Historique/Chat/Récap sont aussi repliables individuellement
 * (voir DashboardLayoutService/ChatPanelService) — une section repliée rejoint le
 * menu latéral `<app-dashboard-rail>` (voir DashboardRailComponent) plutôt que de disparaître
 * purement et simplement. AUCUNE carte n'est cependant considérée "repliée" en mobile, quel que soit
 * le réglage desktop persisté (voir `DashboardLayoutService.isCollapsedForRender`, utilisé par
 * `tabItems` ci-dessous ET par `SessionRecapComponent`/`HistoryComponent`, qui rendent leur propre
 * contenu) — repli explicite du 2026-08-31, en réaction à un retour utilisateur : replier une carte
 * en mobile la rendrait définitivement injoignable sur cet appareil, faute de rail replié sous 800px
 * où la retrouver. */
@Component({
  selector: 'app-dashboard',
  imports: [
    TrackerComponent,
    TrackerStripComponent,
    HistoryComponent,
    SessionRecapComponent,
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
  private readonly auth = inject(AuthService);
  private readonly nav = inject(NavigationService);

  /** Alias vers `NavigationService.dashboardTab` (source unique de vérité, voir son commentaire —
   * synchronisée avec l'URL) plutôt qu'un signal local : `.set()` ici met donc directement à jour
   * la section active ET déclenche `RouteSyncService`. */
  protected readonly activeTab = this.nav.dashboardTab;

  private static readonly TAB_HELP: Partial<Record<DashboardGridKey, HelpSection>> = {
    tracker: 'tracker',
    chat: 'chat',
    hist_combats: 'fightHistory',
    hist_purchases: 'purchases',
    hist_trades: 'trades',
    // Pas d'entrée pour 'hist_group' : son sous-onglet (voir HistoryComponent) porte déjà son
    // propre bouton d'aide par volet regroupé, indépendant de `.panel-header` (masqué en mobile,
    // voir dashboard.component.css/styles.css). Pas d'entrée pour 'recap' non plus : aucune
    // `HelpSection` ne lui correspond (pas de bouton d'aide sur la carte elle-même).
  };

  /** Ordre FIXE des onglets mobile (demande explicite de l'utilisateur, 2026-08-31) — contrairement
   * au placement desktop, qui suit `blockOrder` (personnalisable, voir DashboardLayoutService), la
   * barre d'onglets mobile garde toujours ce même classement, quel que soit l'ordre choisi côté
   * desktop : la personnalisation de la grille n'a pas vocation à réorganiser un simple menu
   * d'onglets. `'hist_group'` juste après `'tracker'` (avant les volets solo restants) : c'est la
   * position qu'occupait "Historique" avant l'introduction des onglets dynamiques, gardée pour ne
   * pas surprendre un utilisateur habitué. Filtré à chaque calcul (voir `tabItems`) : une clé absente
   * de `activeSlots()` (volet regroupé ailleurs, etc.) est simplement sautée. */
  private static readonly MOBILE_TAB_ORDER: readonly DashboardGridKey[] = [
    'tracker',
    'hist_combats',
    'hist_purchases',
    'hist_trades',
    'hist_group',
    'chat',
    'recap',
  ];

  /** Items passés à `<app-tab-bar>` (voir TabBarComponent) — voir doc de tête pour la dérivation
   * dynamique et `MOBILE_TAB_ORDER` pour l'ordre. Aucun filtrage par repli (`isCollapsed`) : en
   * mobile, une carte repliée côté desktop reste joignable (voir `DashboardLayoutService.
   * isCollapsedForRender`, même principe pour Suivi/Chat/Récap/Historique — pas de rail replié sous
   * 800px pour l'accueillir sinon). Libellés courts (`shortSlotLabelKey`, partagé avec le rail
   * replié et Profil › Personnalisation, voir dashboard-body-slot-label.ts) plutôt que le libellé
   * détaillé d'une carte groupée (qui peut lister sa composition, ex. "Historique (Achats +
   * Échanges)") — trop long pour un onglet. Exception "Récap" : `shortSlotLabelKey('recap')` renvoie
   * toujours la clé "opt-in" de Personnalisation ("Récap de session", pertinente pour décrire la
   * carte dans CE contexte précis) — une fois connecté, le nom affiché partout ailleurs (carte,
   * rail replié, Personnalisation) bascule sur "Récap" tout court (`sessionRecap.titleGeneric`, voir
   * SessionRecapComponent/CLAUDE.md, le mot "session" n'ayant plus de sens avec le switch Jour/Mois/
   * Année) — l'onglet mobile ET la feuille "tous les onglets" (même `label`, voir
   * TabBarComponent.openSheet) doivent suivre la même règle plutôt que rester figés sur l'ancien nom
   * (bug réel corrigé, retour utilisateur 2026-08-31). */
  protected readonly tabItems = computed<TabBarItem[]>(() => {
    const active = new Set<DashboardGridKey>([
      'tracker',
      ...this.layout.activeSlots().map((s) => s.key),
    ]);
    const keys = DashboardComponent.MOBILE_TAB_ORDER.filter((id) => active.has(id));
    return keys.map((id) => ({
      id,
      label: this.tabLabelKeyFor(id),
      helpSection: DashboardComponent.TAB_HELP[id],
    }));
  });

  private tabLabelKeyFor(id: DashboardGridKey): string {
    if (id === 'tracker') return 'tracker.header';
    if (id === 'recap' && this.auth.isAuthenticated()) return 'sessionRecap.titleGeneric';
    return shortSlotLabelKey(id as DashboardBodySlotKey);
  }

  /** Onglet mobile réellement actif — `activeTab` (`DashboardTab`) ne distingue pas les volets
   * d'Historique entre eux (une seule valeur `'history'`, voir sa doc de tête) : résolu ici vers le
   * volet scindé précis (`hist_combats`/`hist_purchases`/`hist_trades`) ou vers `'hist_group'` selon
   * `nav.historyTab()`/`DashboardLayoutService.historySplitKeys`, exactement la même correspondance
   * que `HistoryComponent.isSplitHidden`/`isGroupHidden` (à garder synchronisée avec elle). Repli sur
   * `'tracker'` si l'onglet résolu n'apparaît plus dans `tabItems()` (ex. lien direct vers `/recap`
   * alors que la carte est repliée sur cet appareil, ou volet individuellement replié) — sans ce
   * repli, aucun onglet ne matcherait `[activeId]` et l'écran mobile resterait entièrement vide. */
  protected readonly activeMobileTab = computed<DashboardGridKey>(() => {
    const tab = this.activeTab();
    const resolved: DashboardGridKey =
      tab === 'history'
        ? this.layout.historySplitKeys().includes(this.nav.historyTab())
          ? (`hist_${this.nav.historyTab()}` as DashboardGridKey)
          : 'hist_group'
        : tab;
    return this.tabItems().some((item) => item.id === resolved) ? resolved : 'tracker';
  });

  protected selectTab(id: string): void {
    const key = id as DashboardGridKey;
    if (key === 'tracker' || key === 'chat' || key === 'recap') {
      this.activeTab.set(key);
      return;
    }
    // Toute autre clé est un volet d'Historique (solo ou groupé) — voir `activeMobileTab`.
    this.activeTab.set('history');
    if (key === 'hist_group') {
      // Ne PAS laisser `historyTab` tel quel : s'il pointe encore sur un volet resté solo (ex.
      // l'utilisateur vient de cliquer l'onglet "Achats", puis regroupe Combats+Échanges et clique
      // "Historique") `activeMobileTab` le résoudrait à tort vers CE volet solo au lieu du groupe
      // (même correspondance que `historySplitKeys().includes(...)`) — l'onglet "Historique"
      // resterait alors bloqué sur "Achats" quoi qu'on clique dessus (bug réel corrigé, retour
      // utilisateur 2026-08-31). Forcé sur le premier volet regroupé UNIQUEMENT si `historyTab` n'en
      // fait pas déjà partie, pour ne pas perdre le sous-onglet choisi la dernière fois qu'on était
      // dans ce panneau groupé.
      const grouped = this.layout.historyGroupedKeys();
      if (!grouped.includes(this.nav.historyTab())) {
        this.nav.historyTab.set(grouped[0]);
      }
      return;
    }
    this.nav.historyTab.set(key.slice('hist_'.length) as HistoryTab);
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
