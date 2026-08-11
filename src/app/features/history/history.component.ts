import { Component, computed, inject, signal } from '@angular/core';
import { FightHistoryComponent } from '../fight-history/fight-history.component';
import { PurchasesComponent } from '../purchases/purchases.component';
import { TradesComponent } from '../trades/trades.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { HelpModalService } from '../../core/services/help-modal.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { AuthService } from '../../core/auth/auth.service';
import { HistoryArchiveService } from '../../core/sync/history-archive.service';
import type { HistoryEventKind } from '../../core/sync/history-event.model';

type HistoryTab = 'combats' | 'purchases' | 'trades';

/** Type d'événement archivé correspondant à chaque sous-onglet. */
const TAB_EVENT_KIND: Record<HistoryTab, HistoryEventKind> = {
  combats: 'fight',
  purchases: 'purchase',
  trades: 'trade',
};

/**
 * Section "Historique" : regroupe l'historique des combats (voir
 * FightHistoryComponent), l'historique des achats (voir PurchasesComponent)
 * et l'historique des échanges (voir TradesComponent) via trois
 * sous-onglets, remplaçant leur ancien statut de panneaux/onglets séparés du
 * dashboard. Chaque sous-onglet porte sa propre icône "?" (voir template),
 * ouvrant le sujet d'aide correspondant — pas une icône unique contextuelle.
 */
@Component({
  selector: 'app-history',
  imports: [
    FightHistoryComponent,
    PurchasesComponent,
    TradesComponent,
    TranslatePipe,
    IconComponent,
  ],
  templateUrl: './history.component.html',
  styleUrl: './history.component.css',
})
export class HistoryComponent {
  protected readonly helpModal = inject(HelpModalService);
  protected readonly archive = inject(HistoryArchiveService);
  private readonly auth = inject(AuthService);

  protected readonly activeTab = signal<HistoryTab>('combats');

  /** La bascule Session/Compte n'a de sens qu'avec un compte : en mode invité,
   * rien n'a jamais été archivé (§7 du plan, aucune donnée ne quitte l'appareil). */
  protected readonly canShowAccount = this.auth.isAuthenticated;

  /** Vrai s'il reste des pages à charger pour le sous-onglet affiché. */
  protected readonly hasMore = computed(
    () => this.archive.showsAccount() && this.archive.hasMore(TAB_EVENT_KIND[this.activeTab()]),
  );

  protected async showSource(source: 'session' | 'account'): Promise<void> {
    await this.archive.setSource(source);
  }

  protected loadMore(): void {
    void this.archive.loadMore(TAB_EVENT_KIND[this.activeTab()]);
  }
}
