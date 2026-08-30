import { Component, computed, inject, OnDestroy } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FightHistoryComponent } from '../fight-history/fight-history.component';
import { PurchasesComponent } from '../purchases/purchases.component';
import { TradesComponent } from '../trades/trades.component';
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
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { HistoryTab, NavigationService } from '../../core/services/navigation.service';
import { MediaQuerySignal } from '../../core/utils/media-query-signal';
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
};

const HIST_KEYS: readonly DashboardHistoryKey[] = ['combats', 'purchases', 'trades'];

const SLOT_KEY: Record<DashboardHistoryKey, DashboardBodySlotKey> = {
  combats: 'hist_combats',
  purchases: 'hist_purchases',
  trades: 'hist_trades',
};
const HELP_SECTION: Record<DashboardHistoryKey, HelpSection> = {
  combats: 'fightHistory',
  purchases: 'purchases',
  trades: 'trades',
};
/** Clé i18n du titre d'un panneau scindé à part — 'history.splitCombatsHeader' existait déjà pour
 * Combats (voir CLAUDE.md/historique de ce fichier), réutilise directement les libellés d'onglet
 * existants pour Achats/Échanges (pas de nouvelle clé, ce sont déjà les mêmes intitulés que dans le
 * panneau groupé). */
const SOLO_HEADER_KEY: Record<DashboardHistoryKey, string> = {
  combats: 'history.splitCombatsHeader',
  purchases: 'purchases.header',
  trades: 'trades.header',
};

/**
 * Section "Historique" : regroupe l'historique des combats (voir
 * FightHistoryComponent), l'historique des achats (voir PurchasesComponent)
 * et l'historique des échanges (voir TradesComponent).
 *
 * Regroupement piloté par `DashboardLayoutService.historyGroup` (réglable sur Profil ›
 * Personnalisation) — INVERSE de l'ancien réglage "découpage" (voir CLAUDE.md) : par défaut, les 3
 * volets sont chacun leur propre panneau (`effectiveSplitKeys`) ; cocher AU MOINS DEUX volets à
 * regrouper fait apparaître UN panneau groupé (`remainingKeys`) avec un sous-onglet par volet
 * regroupé, les volets restants (non cochés) gardant chacun leur panneau. Desktop uniquement
 * (`isDesktop`, même seuil que `.collapse-btn`) : en mobile, le regroupement n'a pas de sens dans la
 * disposition "un seul panneau à la fois" — toujours le panneau groupé complet (les 3 volets), comme
 * avant cette fonctionnalité.
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
    TranslatePipe,
    IconComponent,
    TooltipDirective,
    SpinnerComponent,
    NgTemplateOutlet,
  ],
  templateUrl: './history.component.html',
  styleUrl: './history.component.css',
})
export class HistoryComponent implements OnDestroy {
  protected readonly helpModal = inject(HelpModalService);
  protected readonly archive = inject(HistoryArchiveService);
  protected readonly auth = inject(AuthService);
  protected readonly layout = inject(DashboardLayoutService);
  protected readonly loadMoreScopeMenu = inject(LoadMoreScopeMenuService);
  private readonly nav = inject(NavigationService);

  /** Même seuil que `.collapse-btn`/`@media (min-width: 801px)` (styles.css, dashboard.component.css) :
   * le découpage ne doit jamais s'appliquer en mobile, où un seul panneau Historique à la fois reste
   * affiché quel que soit le réglage persisté (voir CLAUDE.md/DashboardComponent — un réglage choisi
   * en desktop peut rester actif d'une session desktop précédente). */
  private readonly isDesktop = new MediaQuerySignal('(min-width: 801px)');

  /** Volets affichés chacun dans leur propre panneau — desktop uniquement, voir doc de tête. Tous
   * les 3, sauf si l'utilisateur a coché au moins 2 volets à regrouper (`historyGroup`), auquel cas
   * seuls les volets NON cochés restent solo (les cochés rejoignent le panneau groupé, voir
   * `remainingKeys`) — même règle des "au moins 2" que `DashboardLayoutService.activeSlots`, à
   * garder synchronisée avec elle. */
  protected readonly effectiveSplitKeys = computed<DashboardHistoryKey[]>(() => {
    if (!this.isDesktop.matches()) return [];
    const group = this.layout.historyGroup();
    const groupedKeys = HIST_KEYS.filter((k) => group[k]);
    if (groupedKeys.length < 2) return [...HIST_KEYS];
    return HIST_KEYS.filter((k) => !group[k]);
  });
  /** Volets regroupés dans le panneau commun (0 quand le regroupement n'est pas actif — dans ce cas
   * le panneau groupé ne se rend simplement pas, voir template — sinon 2 ou 3). */
  protected readonly remainingKeys = computed<DashboardHistoryKey[]>(() => {
    const solo = new Set(this.effectiveSplitKeys());
    return HIST_KEYS.filter((k) => !solo.has(k));
  });

  /** `effectiveSplitKeys` moins les volets individuellement repliés (voir `.collapse-btn`) — sans
   * ce filtre, un panneau scindé "replié" resterait quand même rendu dans `.panels-row` (placement
   * `gridColumn:'auto'` par défaut, hors du plan calculé) au lieu de disparaître pour de bon comme
   * Combat/Chat, et rejoindre `DashboardRailComponent` (généralisé, voir sa doc de tête). */
  protected readonly visibleSplitKeys = computed<DashboardHistoryKey[]>(() =>
    this.effectiveSplitKeys().filter((k) => !this.layout.isCollapsed(this.slotKeyFor(k))),
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

  ngOnDestroy(): void {
    this.isDesktop.disconnect();
  }
}
