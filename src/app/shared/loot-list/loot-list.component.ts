import { Component, inject, input } from '@angular/core';
import { LootRow, StatsStoreService } from '../../core/services/stats-store.service';
import { I18nService } from '../../core/services/i18n.service';
import { lootRarityClass } from '../../core/utils/loot-sort.util';
import { CatalogService } from '../../core/api/catalog.service';
import { ItemIconComponent } from '../item-icon/item-icon.component';
import { NumberFrPipe } from '../number-fr.pipe';
import { TranslatePipe } from '../translate.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';

/**
 * Liste de lignes de butin, mutualisée entre FightHistoryComponent (section butin d'un combat,
 * repliable) et SessionRecapComponent (section butin de session, toujours dépliée) — CSS/HTML/
 * comportement des LIGNES elles-mêmes identiques à l'origine (tri déjà appliqué par l'appelant via
 * `items`, clic droit = ajout au suivi, tooltip "cliquer avec le bouton droit" tant que non suivi).
 * L'en-tête (titre, switch de tri, caret repli/dépli éventuel) reste dans chaque composant appelant
 * : leur agencement (hauteur, curseur, hover, bordure pleine/pointillée) diffère réellement entre
 * les deux et n'a pas vocation à être unifié (voir CLAUDE.md, conventions UI transverses).
 */
@Component({
  selector: 'app-loot-list',
  imports: [ItemIconComponent, NumberFrPipe, TranslatePipe, TooltipDirective],
  templateUrl: './loot-list.component.html',
  styleUrl: './loot-list.component.css',
})
export class LootListComponent {
  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);
  private readonly catalog = inject(CatalogService);

  readonly items = input.required<readonly LootRow[]>();
  /** Style du message "aucun butin" : `default` (historique de combat) ou `recap` (modale de fin
   * de session, italique/plus discret) — seule différence visuelle entre les deux origines. */
  readonly emptyVariant = input<'default' | 'recap'>('default');

  protected rarityClass(name: string): string {
    return lootRarityClass(this.catalog, name);
  }

  protected isWatched(name: string): boolean {
    return this.stats.isWatched(name);
  }

  protected onContextMenu(event: MouseEvent, name: string): void {
    event.preventDefault();
    this.stats.addWatchedItem(name);
  }
}
