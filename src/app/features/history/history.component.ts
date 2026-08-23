import { Component, computed, inject, OnDestroy } from '@angular/core';
import { FightHistoryComponent } from '../fight-history/fight-history.component';
import { PurchasesComponent } from '../purchases/purchases.component';
import { TradesComponent } from '../trades/trades.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { HelpModalService, HelpSection } from '../../core/services/help-modal.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { AuthService } from '../../core/auth/auth.service';
import { HistoryArchiveService } from '../../core/sync/history-archive.service';
import type { HistoryEventKind } from '../../core/sync/history-event.model';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { HistoryTab, NavigationService } from '../../core/services/navigation.service';
import { MediaQuerySignal } from '../../core/utils/media-query-signal';
import {
  DashboardBodySlotKey,
  DashboardGridKey,
  DashboardHistoryKey,
  DashboardLayoutService,
} from '../../core/services/dashboard-layout.service';

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
 * Découpage piloté par `DashboardLayoutService.historySplit` (réglable sur Profil ›
 * Personnalisation), désormais indépendant pour chacun des 3 volets — jusqu'à 3 panneaux
 * indépendants (`effectiveSplitKeys`, un par volet scindé) plus, s'il reste au moins un volet non
 * scindé, UN panneau groupé (`remainingKeys`) avec un sous-onglet par volet restant (1 à 3). Desktop
 * uniquement (`isDesktop`, même seuil que `.collapse-btn`) : en mobile, le découpage n'a pas de sens
 * dans la disposition "un seul panneau à la fois" — toujours le panneau groupé complet, comme avant
 * cette fonctionnalité.
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
  ],
  templateUrl: './history.component.html',
  styleUrl: './history.component.css',
})
export class HistoryComponent implements OnDestroy {
  protected readonly helpModal = inject(HelpModalService);
  protected readonly archive = inject(HistoryArchiveService);
  protected readonly auth = inject(AuthService);
  protected readonly layout = inject(DashboardLayoutService);
  private readonly nav = inject(NavigationService);

  /** Même seuil que `.collapse-btn`/`@media (min-width: 801px)` (styles.css, dashboard.component.css) :
   * le découpage ne doit jamais s'appliquer en mobile, où un seul panneau Historique à la fois reste
   * affiché quel que soit le réglage persisté (voir CLAUDE.md/DashboardComponent — un réglage choisi
   * en desktop peut rester actif d'une session desktop précédente). */
  private readonly isDesktop = new MediaQuerySignal('(min-width: 801px)');

  /** Volets effectivement scindés en panneau à part — desktop uniquement, voir doc de tête. */
  protected readonly effectiveSplitKeys = computed<DashboardHistoryKey[]>(() => {
    if (!this.isDesktop.matches()) return [];
    const split = this.layout.historySplit();
    return HIST_KEYS.filter((k) => split[k]);
  });
  /** Volets restant regroupés dans le panneau commun (1 à 3, jamais 0 sauf tous scindés — dans ce
   * cas le panneau groupé ne se rend simplement pas, voir template). */
  protected readonly remainingKeys = computed<DashboardHistoryKey[]>(() => {
    const split = new Set(this.effectiveSplitKeys());
    return HIST_KEYS.filter((k) => !split.has(k));
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

  /** Placement calculé (`grid-column`/`grid-row`/`order`, voir DashboardLayoutService.gridPlan) d'une
   * case de `.panels-row` — appelé avec `'hist_group'` (panneau groupé) ou `slotKeyFor(key)` (panneau
   * scindé), jamais avec une autre clé depuis ce composant. */
  protected gridSlot(key: DashboardGridKey) {
    return this.layout.gridPlan()[key];
  }
  protected slotKeyFor(key: DashboardHistoryKey): DashboardBodySlotKey {
    return SLOT_KEY[key];
  }

  ngOnDestroy(): void {
    this.isDesktop.disconnect();
  }
}
