import { Component, inject, signal } from '@angular/core';
import { FightHistoryComponent } from '../fight-history/fight-history.component';
import { PurchasesComponent } from '../purchases/purchases.component';
import { TradesComponent } from '../trades/trades.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { HelpModalService, HelpSection } from '../../core/services/help-modal.service';

type HistoryTab = 'combats' | 'purchases' | 'trades';

/** Section d'aide correspondant à chaque sous-onglet — voir icône "?" du panel-header. */
const HELP_SECTION_BY_TAB: Record<HistoryTab, HelpSection> = {
  combats: 'fightHistory',
  purchases: 'purchases',
  trades: 'trades',
};

/**
 * Section "Historique" : regroupe l'historique des combats (voir
 * FightHistoryComponent), l'historique des achats (voir PurchasesComponent)
 * et l'historique des échanges (voir TradesComponent) via trois
 * sous-onglets, remplaçant leur ancien statut de panneaux/onglets séparés du
 * dashboard.
 */
@Component({
  selector: 'app-history',
  imports: [FightHistoryComponent, PurchasesComponent, TradesComponent, TranslatePipe],
  templateUrl: './history.component.html',
  styleUrl: './history.component.css',
})
export class HistoryComponent {
  protected readonly helpModal = inject(HelpModalService);
  protected readonly activeTab = signal<HistoryTab>('combats');

  protected openHelp(): void {
    this.helpModal.open(HELP_SECTION_BY_TAB[this.activeTab()]);
  }
}
