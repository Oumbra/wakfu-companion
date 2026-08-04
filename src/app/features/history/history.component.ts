import { Component, inject, signal } from '@angular/core';
import { FightHistoryComponent } from '../fight-history/fight-history.component';
import { PurchasesComponent } from '../purchases/purchases.component';
import { TradesComponent } from '../trades/trades.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { HelpModalService } from '../../core/services/help-modal.service';
import { IconComponent } from '../../shared/icon/icon.component';

type HistoryTab = 'combats' | 'purchases' | 'trades';

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
  imports: [FightHistoryComponent, PurchasesComponent, TradesComponent, TranslatePipe, IconComponent],
  templateUrl: './history.component.html',
  styleUrl: './history.component.css',
})
export class HistoryComponent {
  protected readonly helpModal = inject(HelpModalService);
  protected readonly activeTab = signal<HistoryTab>('combats');
}
