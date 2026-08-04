import { Component, input, output } from '@angular/core';
import { TranslatePipe } from '../translate.pipe';

export type HistoryListSortOrder = 'desc' | 'asc';

/**
 * Bandeau recherche + tri chronologique, mutualisé entre PurchasesComponent et TradesComponent
 * (CSS/HTML/comportement identiques à l'origine — seul le placeholder de recherche diffère).
 * Les libellés de tri ('purchases.sortNewestFirst'/'purchases.sortOldestFirst') sont volontairement
 * génériques (déjà réutilisés tels quels par TradesComponent avant cette factorisation) plutôt que
 * dupliqués sous un nom "trades.*" équivalent.
 */
@Component({
  selector: 'app-history-list-header',
  imports: [TranslatePipe],
  templateUrl: './history-list-header.component.html',
  styleUrl: './history-list-header.component.css',
})
export class HistoryListHeaderComponent {
  readonly searchPlaceholder = input.required<string>();
  readonly searchQuery = input('');
  readonly sortOrder = input<HistoryListSortOrder>('desc');

  readonly searchQueryChange = output<string>();
  readonly sortOrderChange = output<HistoryListSortOrder>();
}
