import { Component, signal } from '@angular/core';
import { FightHistoryComponent } from '../fight-history/fight-history.component';
import { PurchasesComponent } from '../purchases/purchases.component';
import { TranslatePipe } from '../../shared/translate.pipe';

type HistoryTab = 'combats' | 'purchases';

/**
 * Section "Historique" : regroupe l'historique des combats (voir
 * FightHistoryComponent) et l'historique des achats (voir PurchasesComponent)
 * via deux sous-onglets, remplaçant leur ancien statut de panneaux/onglets
 * séparés du dashboard.
 */
@Component({
  selector: 'app-history',
  imports: [FightHistoryComponent, PurchasesComponent, TranslatePipe],
  templateUrl: './history.component.html',
  styleUrl: './history.component.css',
})
export class HistoryComponent {
  protected readonly activeTab = signal<HistoryTab>('combats');
}
