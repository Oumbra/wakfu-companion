import { Component, computed, inject } from '@angular/core';
import { StatsStoreService, WatchlistEntry } from '../../core/services/stats-store.service';
import { LocaleNumberPipe } from '../../shared/locale-number.pipe';
import { EntityIconComponent } from '../../shared/entity-icon/entity-icon.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { WakfuAutocompleteComponent } from '../../shared/wakfu-autocomplete/wakfu-autocomplete.component';
import { WakfuSearchResult } from '../../core/services/wakfu-search.service';
import { ConfirmDeleteService } from '../../core/services/confirm-delete.service';
import { WatchlistTileController } from '../../core/utils/watchlist-tile-controller';
import { IconComponent } from '../../shared/icon/icon.component';
import { CatalogService } from '../../core/api/catalog.service';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { InputNumberComponent } from '../../shared/input-number/input-number.component';

/**
 * Suivi (mobile) : grille de cartes en flex-wrap (voir CLAUDE.md, même
 * principe que `.sound-item-grid` de la page profil), affichée uniquement
 * en dessous du breakpoint mobile (voir CSS) — au-dessus, Suivi est une
 * bande persistante rendue par TrackerStripComponent, pas un onglet.
 *
 * La logique commune avec TrackerStripComponent (rareté/nom affiché/troncature, sélection
 * multiple, création/mode/cible, édition de la valeur courante en décompte, suppression
 * confirmée) vit dans WatchlistTileController — ce composant ne garde que ce qui est propre à la
 * grille tactile (clic sur la carte entière en mode sélection ; pas d'ouverture/fermeture au clic
 * ni de drag&drop, la carte affiche déjà tout en permanence).
 */
@Component({
  selector: 'app-tracker',
  imports: [
    LocaleNumberPipe,
    EntityIconComponent,
    ItemIconComponent,
    TranslatePipe,
    WakfuAutocompleteComponent,
    IconComponent,
    TooltipDirective,
    InputNumberComponent,
  ],
  templateUrl: './tracker.component.html',
  styleUrl: './tracker.component.css',
})
export class TrackerComponent {
  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);

  protected readonly watchlist = new WatchlistTileController(
    this.stats,
    this.i18n,
    inject(ConfirmDeleteService),
    inject(CatalogService),
  );

  protected readonly existingNames = computed(() =>
    this.stats.watchlist().map((w) => ({ name: w.name, kind: w.kind, id: w.catalogId })),
  );

  protected add(result: WakfuSearchResult): void {
    this.watchlist.add(result);
  }

  /** Bascule le mode sélection (bouton "-") : un second clic pendant que le mode est actif le
   * quitte sans rien supprimer, quelle que soit la sélection en cours. */
  protected toggleSelectMode(): void {
    if (this.watchlist.selectMode()) {
      this.watchlist.exitSelectMode();
      return;
    }
    this.watchlist.enterSelectMode();
  }

  /** Clic sur la carte entière (pas seulement la case à cocher) : plus grande zone tactile en
   * mode sélection — sans effet en mode normal (pas de comportement de survol/dépli sur mobile). */
  protected onCardClick(entry: WatchlistEntry): void {
    if (!this.watchlist.selectMode()) return;
    this.watchlist.toggleSelected(entry);
  }
}
