import { Component, computed, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FightHistoryComponent } from '../fight-history/fight-history.component';
import { PurchasesComponent } from '../purchases/purchases.component';
import { TradesComponent } from '../trades/trades.component';
import { PactComponent } from '../pact/pact.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { HelpModalService, HelpSection } from '../../core/services/help-modal.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { AuthService } from '../../core/auth/auth.service';
import { HistoryArchiveService } from '../../core/sync/history-archive.service';
import {
  LOAD_MORE_SPAN_MS,
  type HistoryEventKind,
  type LoadMoreSpan,
} from '../../core/sync/history-event.model';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { LoadMoreScopeMenuService } from '../../core/services/load-more-scope-menu.service';
import { HistoryTab, NavigationService } from '../../core/services/navigation.service';
import {
  DashboardBodySlotKey,
  DashboardGridKey,
  DashboardHistoryKey,
  DashboardLayoutService,
} from '../../core/services/dashboard-layout.service';
import { dashboardBodySlotIcon } from '../../core/services/dashboard-body-slot-label';
import { AppIconName } from '../../shared/icon/icon.component';

/** Type d'événement archivé correspondant à chaque sous-onglet. */
const TAB_EVENT_KIND: Record<HistoryTab, HistoryEventKind> = {
  combats: 'fight',
  purchases: 'purchase',
  trades: 'trade',
  pacts: 'pact',
};

const SLOT_KEY: Record<DashboardHistoryKey, DashboardBodySlotKey> = {
  combats: 'hist_combats',
  purchases: 'hist_purchases',
  trades: 'hist_trades',
  pacts: 'hist_pacts',
};
const HELP_SECTION: Record<DashboardHistoryKey, HelpSection> = {
  combats: 'fightHistory',
  purchases: 'purchases',
  trades: 'trades',
  pacts: 'pacts',
};
/** Clé i18n du titre d'un panneau scindé à part — 'history.splitCombatsHeader' existait déjà pour
 * Combats (voir CLAUDE.md/historique de ce fichier), réutilise directement les libellés d'onglet
 * existants pour Achats/Échanges/Pacte (pas de nouvelle clé, ce sont déjà les mêmes intitulés que
 * dans le panneau groupé). */
const SOLO_HEADER_KEY: Record<DashboardHistoryKey, string> = {
  combats: 'history.splitCombatsHeader',
  purchases: 'purchases.header',
  trades: 'trades.header',
  pacts: 'pacts.header',
};

/**
 * Section "Historique" : regroupe l'historique des combats (voir
 * FightHistoryComponent), l'historique des achats (voir PurchasesComponent)
 * et l'historique des échanges (voir TradesComponent).
 *
 * Regroupement piloté par `DashboardLayoutService.historyGroup` (réglable sur Profil ›
 * Personnalisation) — INVERSE de l'ancien réglage "découpage" (voir CLAUDE.md) : par défaut, les 3
 * volets sont chacun leur propre panneau (`effectiveSplitKeys`, alias de
 * `DashboardLayoutService.historySplitKeys`) ; cocher AU MOINS DEUX volets à regrouper fait
 * apparaître UN panneau groupé (`remainingKeys`, alias de `historyGroupedKeys`) avec un sous-onglet
 * par volet regroupé, les volets restants (non cochés) gardant chacun leur panneau. Device-
 * INDÉPENDANT depuis l'introduction des onglets mobile dynamiques (voir `DashboardComponent`,
 * CLAUDE.md) : la personnalisation choisie s'applique désormais aussi bien en desktop (panneaux
 * côte à côte) qu'en mobile (un onglet par panneau — `[class.tab-hidden]` posé sur chaque `.tool-panel`
 * ci-dessous compare `nav.dashboardTab()`/`nav.historyTab()` à SA propre identité, sans effet en
 * desktop où la règle CSS correspondante est scopée à `@media (max-width: 800px)` — GLOBALE, voir
 * `.panels-row .tab-hidden` dans styles.css, pas dashboard.component.css : ce `.tool-panel` est
 * rendu ICI, sous l'attribut d'encapsulation de vue de CE composant, qu'un sélecteur scopé à
 * `DashboardComponent` ne peut pas atteindre). Avant ce changement, un seuil `isDesktop` forçait un panneau groupé
 * unique (les 3 volets) en mobile quel que soit le réglage — ce qui rendait Combat/Achats/Échanges
 * injoignables dès que l'utilisateur ne les regroupait pas (bug réel corrigé, voir CLAUDE.md).
 *
 * `:host { display: contents }` (voir CSS) : chaque `.tool-panel` rendu par ce composant devient un
 * enfant direct du grid `.panels-row` de `DashboardComponent` — même principe que
 * `DashboardRailComponent`, nécessaire pour qu'un panneau scindé devienne une vraie case de grille
 * indépendante plutôt qu'imbriquée dans une seule. Chaque panneau reçoit son placement
 * (`grid-column`/`grid-row`/`order`) depuis `DashboardLayoutService.gridPlan` — calculé une fois
 * pour tout le tableau de bord, voir sa doc de tête.
 *
 * Chaque panneau (scindé OU groupé) est aussi repliable individuellement, comme Combat/Chat — un
 * `.collapse-btn` dans son `panel-header` (voir template) appelle `layout.toggleCollapsed(...)`, ce
 * qui le fait rejoindre `DashboardRailComponent` (généralisé, voir sa doc de tête) au lieu de
 * disparaître purement et simplement.
 */
@Component({
  selector: 'app-history',
  imports: [
    FightHistoryComponent,
    PurchasesComponent,
    TradesComponent,
    PactComponent,
    TranslatePipe,
    IconComponent,
    TooltipDirective,
    NgTemplateOutlet,
  ],
  templateUrl: './history.component.html',
  styleUrl: './history.component.css',
})
export class HistoryComponent {
  protected readonly helpModal = inject(HelpModalService);
  protected readonly archive = inject(HistoryArchiveService);
  protected readonly auth = inject(AuthService);
  protected readonly layout = inject(DashboardLayoutService);
  protected readonly loadMoreScopeMenu = inject(LoadMoreScopeMenuService);
  private readonly nav = inject(NavigationService);

  /** Alias direct — voir `DashboardLayoutService.historySplitKeys`/`historyGroupedKeys`, calcul
   * partagé avec `activeSlots` (desktop) et `DashboardComponent` (onglets mobile). */
  protected readonly effectiveSplitKeys = this.layout.historySplitKeys;
  protected readonly remainingKeys = this.layout.historyGroupedKeys;

  /** Section active de `main` (voir `NavigationService.dashboardTab`) — nécessaire en plus de
   * `activeTab` (alias de `historyTab` ci-dessous) pour déterminer si UN panneau de CE composant est
   * l'onglet mobile actif : `historyTab` seul ne suffit pas, un autre onglet de haut niveau (Suivi,
   * Chat...) peut être actif alors que `historyTab` garde la dernière valeur choisie dans
   * Historique. */
  protected readonly dashboardTab = this.nav.dashboardTab;

  /** `effectiveSplitKeys` moins les volets individuellement repliés (voir `.collapse-btn`) — sans
   * ce filtre, un panneau scindé "replié" resterait quand même rendu dans `.panels-row` (placement
   * `gridColumn:'auto'` par défaut, hors du plan calculé) au lieu de disparaître pour de bon comme
   * Combat/Chat, et rejoindre `DashboardRailComponent` (généralisé, voir sa doc de tête).
   * `isCollapsedForRender` (pas `isCollapsed`) : en mobile, un volet repose replié côté desktop doit
   * quand même rester joignable (voir sa doc de tête — pas de rail replié sous 800px). */
  protected readonly visibleSplitKeys = computed<DashboardHistoryKey[]>(() =>
    this.effectiveSplitKeys().filter((k) => !this.layout.isCollapsedForRender(this.slotKeyFor(k))),
  );

  /** Alias vers `NavigationService.historyTab` (source unique de vérité, voir son commentaire —
   * synchronisée avec l'URL) plutôt qu'un signal local : `.set()` ici met donc directement à jour
   * la section active ET déclenche `RouteSyncService`. */
  protected readonly activeTab = this.nav.historyTab;

  /** Sous-onglet réellement affiché dans le panneau groupé : `activeTab()` si encore parmi les
   * volets restants, sinon le premier restant (ex. juste après avoir scindé le volet qui était
   * sélectionné) — généralisation de l'ancien `secondaryTab`, plus limité à 2 volets fixes. */
  protected readonly groupActiveTab = computed<DashboardHistoryKey>(() => {
    const remaining = this.remainingKeys();
    const current = this.activeTab();
    return remaining.includes(current) ? current : remaining[0];
  });

  protected helpSectionFor(key: DashboardHistoryKey): HelpSection {
    return HELP_SECTION[key];
  }
  protected soloHeaderKeyFor(key: DashboardHistoryKey): string {
    return SOLO_HEADER_KEY[key];
  }
  protected tabLabelKeyFor(key: DashboardHistoryKey): string {
    return key === 'combats' ? 'history.tabCombats' : SOLO_HEADER_KEY[key];
  }

  protected hasMoreFor(key: DashboardHistoryKey): boolean {
    return this.auth.isAuthenticated() && this.archive.hasMore(TAB_EVENT_KIND[key]);
  }
  protected loadMoreFor(key: DashboardHistoryKey): void {
    // Les achats se chargent toujours par jour complet (voir CLAUDE.md / HistoryArchiveService) —
    // les combats/échanges suivent la pagination "une page à la fois" habituelle.
    void (key === 'purchases'
      ? this.archive.loadMorePurchasesUntilDayComplete()
      : this.archive.loadMore(TAB_EVENT_KIND[key]));
  }

  /** Ouvre le menu "1 semaine / 1 mois / 1 an" (voir LoadMoreScopeMenuService) ancré sur le bouton
   * cliqué — `event.currentTarget` plutôt que `event.target` : le clic peut arriver sur l'icône SVG
   * interne du bouton, pas nécessairement sur le `<button>` lui-même. */
  protected openLoadMoreScopeMenu(event: MouseEvent, key: DashboardHistoryKey): void {
    this.loadMoreScopeMenu.open(event.currentTarget as HTMLElement, (span) =>
      this.loadMoreSpanFor(key, span),
    );
  }

  private loadMoreSpanFor(key: DashboardHistoryKey, span: LoadMoreSpan): void {
    void this.archive.loadMoreForSpan(TAB_EVENT_KIND[key], LOAD_MORE_SPAN_MS[span]);
  }

  /** Placement calculé (`grid-column`/`grid-row`/`order`, voir DashboardLayoutService.gridPlan) d'une
   * case de `.panels-row` — appelé avec `'hist_group'` (panneau groupé) ou `slotKeyFor(key)` (panneau
   * scindé), jamais avec une autre clé depuis ce composant. */
  protected gridSlot(key: DashboardGridKey) {
    return this.layout.gridPlan()[key];
  }
  protected slotKeyFor(key: DashboardHistoryKey): DashboardBodySlotKey {
    return SLOT_KEY[key];
  }
  /** Icône du panneau scindé à part (voir `panel-header`) — même icône que dans le rail replié
   * (`DashboardRailComponent`, généralisé) pour rester reconnaissable d'un endroit à l'autre : sans
   * ça, Achats/Échanges scindés partageaient la même horloge générique que Combats, illisible une
   * fois qu'il y en a plusieurs à l'écran (retour utilisateur). Le panneau GROUPÉ garde l'horloge
   * (mélange de volets, pas d'icône plus spécifique pertinente — voir template). */
  protected iconFor(key: DashboardHistoryKey): AppIconName {
    return dashboardBodySlotIcon(this.slotKeyFor(key));
  }

  /** Mobile uniquement (voir doc de tête) — un panneau scindé n'est l'onglet mobile actif que si
   * `dashboardTab` vaut `'history'` ET que `historyTab` pointe précisément sur SON volet. Sans effet
   * en desktop : la règle CSS qui donne un sens à la classe `.tab-hidden` posée grâce à ce booléen
   * est scopée à `@media (max-width: 800px)` — GLOBALE (`.panels-row .tab-hidden` dans styles.css,
   * pas dashboard.component.css) car ce `.tool-panel` est rendu par CE composant, sous son propre
   * attribut d'encapsulation de vue, qu'un sélecteur scopé à `DashboardComponent` ne peut pas
   * atteindre (voir CLAUDE.md, même piège que `.panels-row .tool-panel`/`.panel-header`). */
  protected isSplitHidden(key: DashboardHistoryKey): boolean {
    return this.dashboardTab() !== 'history' || this.activeTab() !== key;
  }
  /** Symétrique de `isSplitHidden` pour le panneau groupé : caché si `historyTab` pointe en fait sur
   * un volet resté solo (un panneau scindé est alors affiché à sa place, voir `isSplitHidden`). */
  protected isGroupHidden(): boolean {
    return (
      this.dashboardTab() !== 'history' || this.effectiveSplitKeys().includes(this.activeTab())
    );
  }
}
