import { Component, computed, inject, input, signal } from '@angular/core';
import { FightRecord, LootRow, StatsStoreService } from '../../core/services/stats-store.service';
import { I18nService } from '../../core/services/i18n.service';
import { lootRarityClass } from '../../core/utils/loot-sort.util';
import { normalizeWakfuName } from '../../core/utils/wakfu-name.util';
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
 * `items`, clic droit = correction d'objet homonyme, voir ItemPickerService) plus le filtrage par
 * recherche (`searchQuery`, propre à cette instance — voir `filteredItems`). L'en-tête (titre,
 * switch de tri, caret repli/dépli éventuel) reste dans chaque composant appelant : leur agencement
 * (hauteur, curseur, hover, bordure pleine/pointillée) diffère réellement entre les deux et n'a pas
 * vocation à être unifié (voir CLAUDE.md, conventions UI transverses) — seul le champ de recherche,
 * identique aux deux appelants, vit ici.
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
   * de session, italique/plus discret) — seule différence visuelle entre les deux origines. Sert
   * aussi bien au cas "aucun butin du tout" qu'au cas "recherche sans résultat" (même message,
   * même convention que PurchasesComponent/TradesComponent — pas de clé dédiée). */
  readonly emptyVariant = input<'default' | 'recap'>('default');
  /** Combat d'origine de ce butin — nécessaire pour cibler une correction manuelle d'objet (voir
   * ItemPickerService, `StatsStoreService.reassignLootItem`) : `null` pour la vue "butin cumulé de
   * session" (`session-recap`), qui agrège plusieurs combats et ne peut donc pas cibler une ligne
   * précise — aucune interaction n'est alors proposée (voir `canInteract`). */
  readonly fight = input<Pick<FightRecord, 'time' | 'result' | 'rows'> | null>(null);

  /** Texte de recherche courant — propre à cette instance (pas remonté à l'appelant), remis à zéro
   * implicitement à chaque nouvelle instance (combat replié/déplié à nouveau, changement de combat
   * affiché...). */
  protected readonly searchQuery = signal('');

  /** Nom affiché tel que l'utilisateur le voit (traduit) — même expression que le template pour la
   * ligne, réutilisée ici pour que la recherche porte sur ce qui est réellement affiché plutôt que
   * sur le nom brut du log (pas forcément dans la langue active). */
  protected displayName(row: LootRow): string {
    return this.i18n.translateItemNameById(row.catalogId, this.i18n.translateItemName(row.name));
  }

  /** `items()` filtré par `searchQuery` (recherche sous-chaîne, insensible à la casse/aux accents —
   * voir normalizeWakfuName), tri déjà appliqué par l'appelant conservé tel quel. */
  protected readonly filteredItems = computed<readonly LootRow[]>(() => {
    const query = normalizeWakfuName(this.searchQuery().trim());
    if (!query) return this.items();
    return this.items().filter((row) => normalizeWakfuName(this.displayName(row)).includes(query));
  });

  protected clearSearch(): void {
    this.searchQuery.set('');
  }

  protected rarityClass(row: LootRow): string {
    return lootRarityClass(this.catalog, row.name, row.catalogId);
  }

  /** Une correction n'a de sens que (1) pour une ligne rattachée à un combat précis (voir `fight`,
   * absent pour le butin cumulé de session) ET (2) si le référentiel Ankama connaît plusieurs
   * objets de ce nom (sinon rien à départager, voir ItemPickerComponent.showModify) — sans ces deux
   * conditions, le clic droit ne doit plus rien proposer du tout (voir CLAUDE.md : le bouton
   * "Suivre" a été retiré du menu, qui ne sert donc plus qu'à cette correction). */
  protected canInteract(row: LootRow): boolean {
    return this.fight() !== null && this.catalog.findAllWakfuItemEntriesByName(row.name).length > 1;
  }

  protected openInteractMenu(event: MouseEvent, row: LootRow): void {
    event.preventDefault();
    event.stopPropagation();
    const fight = this.fight();
    if (!fight || !this.canInteract(row)) return;
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
      onChosen: (id, quantity) => {
        this.stats.reassignLootItem(fight, row.name, row.catalogId, quantity, id);
        this.archive.reassignLootItem(fight, row.name, row.catalogId, quantity, id);
      },
    });
  }
}
