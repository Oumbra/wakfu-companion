import { Component, inject, input } from '@angular/core';
import { FightRecord, LootRow, StatsStoreService } from '../../core/services/stats-store.service';
import { I18nService } from '../../core/services/i18n.service';
import { lootRarityClass } from '../../core/utils/loot-sort.util';
import { CatalogService } from '../../core/api/catalog.service';
import { ItemIconComponent } from '../item-icon/item-icon.component';
import { NumberFrPipe } from '../number-fr.pipe';
import { TranslatePipe } from '../translate.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';
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
  imports: [ItemIconComponent, NumberFrPipe, TranslatePipe, TooltipDirective],
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
   * précise — seul "+ Suivre" reste offert dans ce cas (voir ItemPickerRequest.onChosen). `loot`
   * (tableau BRUT, non trié) fait partie du Pick uniquement pour `occurrenceOf` ci-dessous — voir
   * sa doc, PAS pour l'affichage (qui reste piloté par `items`, potentiellement trié différemment
   * par l'appelant). */
  readonly fight = input<Pick<FightRecord, 'time' | 'result' | 'rows' | 'loot'> | null>(null);

  protected rarityClass(row: LootRow): string {
    return lootRarityClass(this.catalog, row.name, row.catalogId);
  }

  protected isWatched(name: string): boolean {
    return this.stats.isWatched(name);
  }

  /**
   * Rang de `items()[index]` parmi les lignes de même nom qui le précèdent, calculé contre l'ordre
   * BRUT du store (`fight().loot`) plutôt que contre `items()` — voir `StatsStoreService.
   * reassignLootItem` (`occurrence`) : le store cible une ligne par son rang dans `record.loot`, pas
   * dans la vue affichée, potentiellement triée différemment par l'appelant (voir
   * `FightHistoryComponent.sortedLoot`/`lootSort`). Sous le tri "Nom" (par défaut), les deux ordres
   * coïncident toujours pour des lignes homonymes (tri stable, noms strictement identiques) — mais
   * PAS sous "Quantité"/"Rareté", qui peuvent réordonner deux lignes homonymes l'une par rapport à
   * l'autre puisque leurs quantités/raretés diffèrent justement (bug réel corrigé : sous ces tris,
   * une correction pouvait silencieusement viser la mauvaise ligne). `sortedLoot()` ne clone jamais
   * les lignes elles-mêmes (`[...loot].sort(...)`, copie superficielle du tableau) : chaque élément
   * de `items()` reste donc le MÊME objet que dans `fight().loot`, ce qui permet de retrouver sa
   * position réelle par référence (`indexOf`) plutôt que par un ré-appariement approximatif.
   */
  protected occurrenceOf(index: number): number {
    const items = this.items();
    const target = items[index];
    const name = target.name.toLowerCase();
    const raw = this.fight()?.loot;
    if (!raw) {
      // Pas de combat ciblable (butin cumulé de session, voir `fight`) : occurrence jamais
      // consommée par l'appelant dans ce cas (`onChosen` absent) — un repli approximatif suffit.
      return items.slice(0, index).filter((i) => i.name.toLowerCase() === name).length;
    }
    const rawIndex = raw.indexOf(target);
    return raw.slice(0, Math.max(0, rawIndex)).filter((i) => i.name.toLowerCase() === name).length;
  }

  protected openInteractMenu(event: MouseEvent, row: LootRow, index: number): void {
    event.preventDefault();
    event.stopPropagation();
    const fight = this.fight();
    const occurrence = this.occurrenceOf(index);
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
            this.stats.reassignLootItem(fight, row.name, occurrence, quantity, id);
            this.archive.reassignLootItem(fight, row.name, occurrence, quantity, id);
          }
        : undefined,
    });
  }
}
