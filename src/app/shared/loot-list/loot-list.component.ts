import { Component, inject, input } from '@angular/core';
import { FightRecord, LootRow, StatsStoreService } from '../../core/services/stats-store.service';
import { I18nService } from '../../core/services/i18n.service';
import { lootRarityClass } from '../../core/utils/loot-sort.util';
import { CatalogService } from '../../core/api/catalog.service';
import { ItemIconComponent } from '../item-icon/item-icon.component';
import { IconComponent } from '../icon/icon.component';
import { NumberFrPipe } from '../number-fr.pipe';
import { TranslatePipe } from '../translate.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';
import { ItemPickerService } from '../../core/services/item-picker.service';
import { HistoryArchiveService } from '../../core/sync/history-archive.service';

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
  imports: [ItemIconComponent, IconComponent, NumberFrPipe, TranslatePipe, TooltipDirective],
  templateUrl: './loot-list.component.html',
  styleUrl: './loot-list.component.css',
})
export class LootListComponent {
  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);
  private readonly catalog = inject(CatalogService);
  private readonly itemPicker = inject(ItemPickerService);
  private readonly archive = inject(HistoryArchiveService);

  readonly items = input.required<readonly LootRow[]>();
  /** Style du message "aucun butin" : `default` (historique de combat) ou `recap` (modale de fin
   * de session, italique/plus discret) — seule différence visuelle entre les deux origines. */
  readonly emptyVariant = input<'default' | 'recap'>('default');
  /** Combat d'origine de ce butin — nécessaire pour cibler une correction manuelle d'objet (voir
   * ItemPickerService, `StatsStoreService.reassignLootItem`) : `null` pour la vue "butin cumulé de
   * session" (`session-recap`), qui agrège plusieurs combats et ne peut donc pas cibler une ligne
   * précise — le bouton de correction n'y est simplement pas affiché. */
  readonly fight = input<Pick<FightRecord, 'time' | 'result' | 'rows'> | null>(null);

  protected rarityClass(row: LootRow): string {
    return lootRarityClass(this.catalog, row.name, row.catalogId);
  }

  protected isWatched(name: string): boolean {
    return this.stats.isWatched(name);
  }

  protected onContextMenu(event: MouseEvent, name: string): void {
    event.preventDefault();
    this.stats.addWatchedItem(name);
  }

  protected openItemPicker(event: MouseEvent, row: LootRow): void {
    event.preventDefault();
    event.stopPropagation();
    const fight = this.fight();
    if (!fight) return;
    this.itemPicker.open({
      name: row.name,
      x: event.clientX,
      y: event.clientY,
      currentId: row.catalogId,
      onChosen: (id) => {
        this.stats.reassignLootItem(fight, row.name, id);
        this.archive.reassignLootItem(fight, row.name, id);
      },
    });
  }
}
