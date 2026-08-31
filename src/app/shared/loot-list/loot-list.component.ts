import { Component, inject, input } from '@angular/core';
import { FightRecord, LootRow, StatsStoreService } from '../../core/services/stats-store.service';
import { I18nService } from '../../core/services/i18n.service';
import { lootRarityClass } from '../../core/utils/loot-sort.util';
import { CatalogService } from '../../core/api/catalog.service';
import { ItemIconComponent } from '../item-icon/item-icon.component';
import { NumberFrPipe } from '../number-fr.pipe';
import { TranslatePipe } from '../translate.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';
import { IconComponent } from '../icon/icon.component';
import { ItemPickerService } from '../../core/services/item-picker.service';
import { HistoryArchiveService } from '../../core/sync/history-archive.service';

/**
 * Liste de lignes de butin, mutualisée entre FightHistoryComponent (section butin d'un combat,
 * repliable) et SessionRecapComponent (section butin de session, toujours dépliée) — CSS/HTML/
 * comportement des LIGNES elles-mêmes identiques à l'origine (tri déjà appliqué par l'appelant via
 * `items`, clic droit = menu "Interagir" — suivi + correction d'objet, voir ItemPickerService).
 * L'en-tête (titre, switch de tri, caret repli/dépli éventuel) reste dans chaque composant appelant
 * : leur agencement (hauteur, curseur, hover, bordure pleine/pointillée) diffère réellement entre
 * les deux et n'a pas vocation à être unifié (voir CLAUDE.md, conventions UI transverses).
 */
@Component({
  selector: 'app-loot-list',
  imports: [ItemIconComponent, NumberFrPipe, TranslatePipe, TooltipDirective, IconComponent],
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
   * précise — seul "+ Suivre" reste offert dans ce cas (voir ItemPickerRequest.onChosen). */
  readonly fight = input<Pick<FightRecord, 'time' | 'result' | 'rows'> | null>(null);

  protected rarityClass(row: LootRow): string {
    return lootRarityClass(this.catalog, row.name, row.catalogId);
  }

  protected isWatched(name: string): boolean {
    return this.stats.isWatched(name);
  }

  /** Vrai si le référentiel Ankama contient plusieurs objets partageant ce nom (homonymes de
   * rareté différente, ex. "Larme d'Ogrest") — la ligne peut alors être corrigée manuellement
   * (voir ItemPickerService/`onChosen`). N'a de sens que dans l'historique de combat (`fight` non
   * `null`, voir doc de `fight` ci-dessus) : le butin cumulé de session n'a pas de combat unique à
   * cibler, la correction n'y est de toute façon jamais proposée. Sert à afficher le badge clé
   * plate (voir template) sans obliger l'utilisateur à survoler chaque ligne pour le découvrir. */
  protected isCorrectable(row: LootRow): boolean {
    return this.fight() !== null && this.catalog.findAllWakfuItemEntriesByName(row.name).length > 1;
  }

  /** Ouvre le menu d'interaction (suivi + correction) — déclenché soit par un clic droit n'importe
   * où sur la ligne (`contextmenu`), soit par un clic gauche direct sur le badge de correction
   * (voir `isCorrectable`) quand il est affiché : mêmes coordonnées d'ouverture (`event.clientX/Y`)
   * dans les deux cas, donc positionné près du badge cliqué plutôt que recentré sur la ligne. */
  protected openInteractMenu(event: MouseEvent, row: LootRow): void {
    event.preventDefault();
    event.stopPropagation();
    const fight = this.fight();
    // Cible la ligne par son `catalogId` ACTUEL (voir StatsStoreService.reassignLootItem,
    // `sourceCatalogId`) plutôt que par un rang positionnel — insensible à l'ordre d'affichage
    // (`items()` peut être trié différemment de l'ordre de stockage, voir
    // FightHistoryComponent.sortedLoot/lootSort) et plus simple : `row.catalogId` suffit, pas
    // besoin de recalculer quoi que ce soit contre le tableau brut du combat.
    this.itemPicker.open({
      name: row.name,
      x: event.clientX,
      y: event.clientY,
      currentId: row.catalogId,
      quantity: row.quantity,
      isWatched: this.isWatched(row.name),
      onFollow: () => this.stats.addWatchedItem(row.name),
      onChosen: fight
        ? (id, quantity) => {
            this.stats.reassignLootItem(fight, row.name, row.catalogId, quantity, id);
            this.archive.reassignLootItem(fight, row.name, row.catalogId, quantity, id);
          }
        : undefined,
    });
  }
}
