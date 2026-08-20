import { Component, computed, inject, OnDestroy } from '@angular/core';
import { FightHistoryComponent } from '../fight-history/fight-history.component';
import { PurchasesComponent } from '../purchases/purchases.component';
import { TradesComponent } from '../trades/trades.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { HelpModalService } from '../../core/services/help-modal.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { AuthService } from '../../core/auth/auth.service';
import { HistoryArchiveService } from '../../core/sync/history-archive.service';
import type { HistoryEventKind } from '../../core/sync/history-event.model';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { HistoryTab, NavigationService } from '../../core/services/navigation.service';
import { ChatPanelService } from '../../core/services/chat-panel.service';
import { MediaQuerySignal } from '../../core/utils/media-query-signal';

/** Type d'événement archivé correspondant à chaque sous-onglet. */
const TAB_EVENT_KIND: Record<HistoryTab, HistoryEventKind> = {
  combats: 'fight',
  purchases: 'purchase',
  trades: 'trade',
};

/**
 * Section "Historique" : regroupe l'historique des combats (voir
 * FightHistoryComponent), l'historique des achats (voir PurchasesComponent)
 * et l'historique des échanges (voir TradesComponent).
 *
 * Deux agencements, choisis par `splitCombats` :
 *  - par défaut : les trois dans UN SEUL panneau à trois sous-onglets (comportement historique),
 *    chaque sous-onglet portant sa propre icône "?" (voir template) ouvrant le sujet d'aide
 *    correspondant.
 *  - desktop uniquement, quand le panneau Chat est replié (voir ChatPanelService) : la place
 *    libérée par Chat dans `.panels-row` (voir dashboard.component.css) est réutilisée pour
 *    scinder Combats dans SON PROPRE panneau indépendant, à côté d'un second panneau
 *    Achats/Échanges (deux sous-onglets au lieu de trois) — plutôt que de laisser Historique
 *    s'étirer seul sur toute la largeur avec un onglet Combats qui n'en profite pas particulièrement.
 *
 * `:host { display: contents }` (voir CSS) : les un ou deux `.tool-panel` rendus par ce composant
 * deviennent des enfants directs du flex `:host` de DashboardComponent — même principe que
 * DashboardRailComponent, nécessaire pour que le second panneau (scission active) devienne une
 * vraie colonne de grille indépendante plutôt qu'imbriquée dans une seule.
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
  protected readonly chatPanel = inject(ChatPanelService);
  private readonly nav = inject(NavigationService);

  /** Même seuil que `.collapse-btn`/`@media (min-width: 801px)` (styles.css, dashboard.component.css) :
   * la scission ne doit jamais s'appliquer en mobile, où Chat reste visible quel que soit l'état
   * replié persisté (voir CLAUDE.md/DashboardComponent — le bouton qui replie Chat est lui-même
   * masqué sous ce seuil, mais le *signal* `chatPanel.collapsed()` peut rester à `true` d'une
   * session desktop précédente). */
  private readonly isDesktop = new MediaQuerySignal('(min-width: 801px)');

  /** Vrai desktop uniquement, quand Chat est replié — voir la doc de tête de la classe. */
  protected readonly splitCombats = computed(
    () => this.isDesktop.matches() && this.chatPanel.collapsed(),
  );

  /** Alias vers `NavigationService.historyTab` (source unique de vérité, voir son commentaire —
   * synchronisée avec l'URL) plutôt qu'un signal local : `.set()` ici met donc directement à jour
   * la section active ET déclenche `RouteSyncService`. */
  protected readonly activeTab = this.nav.historyTab;

  /** Sous-onglet affiché dans le second panneau une fois Combats scindé à part (voir
   * `splitCombats`) : 'trades' si explicitement sélectionné, 'purchases' sinon — y compris quand
   * `activeTab()` vaut encore 'combats' (ex. juste après le repli de Chat qui déclenche la
   * scission), qu'aucun des deux panneaux ne pourrait autrement représenter. */
  protected readonly secondaryTab = computed<'purchases' | 'trades'>(() =>
    this.activeTab() === 'trades' ? 'trades' : 'purchases',
  );

  /** Vrai s'il reste des pages d'archive à charger pour le sous-onglet affiché (panneau unique,
   * scission inactive) — en mode invité, rien n'a jamais été archivé (§7 du plan, aucune donnée ne
   * quitte l'appareil), donc toujours faux. */
  protected readonly hasMore = computed(
    () => this.auth.isAuthenticated() && this.archive.hasMore(TAB_EVENT_KIND[this.activeTab()]),
  );

  protected loadMore(): void {
    this.loadMoreForKind(TAB_EVENT_KIND[this.activeTab()]);
  }

  /** Miroir de `hasMore`, pour le panneau Combats une fois scindé à part — toujours le type
   * 'fight', indépendamment de `activeTab()` (qui ne pilote plus que le second panneau). */
  protected readonly combatsHasMore = computed(
    () => this.auth.isAuthenticated() && this.archive.hasMore('fight'),
  );

  protected loadMoreCombats(): void {
    this.loadMoreForKind('fight');
  }

  /** Miroir de `hasMore`, pour le second panneau (Achats/Échanges) une fois Combats scindé à
   * part — voir `secondaryTab`. */
  protected readonly secondaryHasMore = computed(() =>
    this.auth.isAuthenticated()
      ? this.archive.hasMore(TAB_EVENT_KIND[this.secondaryTab()])
      : false,
  );

  protected loadMoreSecondary(): void {
    this.loadMoreForKind(TAB_EVENT_KIND[this.secondaryTab()]);
  }

  /** Les achats se chargent toujours par jour complet (voir CLAUDE.md / HistoryArchiveService) —
   * les combats/échanges suivent la pagination "une page à la fois" habituelle. */
  private loadMoreForKind(kind: HistoryEventKind): void {
    void (kind === 'purchase'
      ? this.archive.loadMorePurchasesUntilDayComplete()
      : this.archive.loadMore(kind));
  }

  ngOnDestroy(): void {
    this.isDesktop.disconnect();
  }
}
