import { Component, computed, inject, signal } from '@angular/core';
import {
  EntityDamageRow,
  FightRecord,
  LootRow,
  StatsStoreService,
} from '../../core/services/stats-store.service';
import { EntityClassifierService } from '../../core/services/entity-classifier.service';
import { ClassPickerService } from '../../core/services/class-picker.service';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { EntityDamageListComponent } from '../damage-meter/entity-damage-list/entity-damage-list.component';
import { EntityIconComponent } from '../../shared/entity-icon/entity-icon.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { getWakfuItemRarity, RARITY_SORT_ORDER } from '../../core/data/wakfu-item-rarity.data';
import {
  HEADER_ICON_LOOT_DATA_URI,
  HEADER_ICON_XP_DATA_URI,
} from '../../core/data/header-icons.data';
import { RARITY_ICON_BASE_DATA_URI, RARITY_SORT_ICON_DATA_URI } from '../../core/data/rarity-icon.data';

type LootSort = 'name' | 'quantity' | 'rarity';

/**
 * Historique des combats (liste repliable, butin, XP) — extrait de
 * DamageMeterComponent pour être affiché comme sous-onglet "Combats" de la
 * nouvelle section Historique (voir HistoryComponent), à côté des achats.
 * Rendu directement au niveau du `.tool-panel` parent (`:host{display:contents}`),
 * même principe que PurchasesComponent.
 */
@Component({
  selector: 'app-fight-history',
  imports: [NumberFrPipe, EntityDamageListComponent, EntityIconComponent, ItemIconComponent, TranslatePipe],
  templateUrl: './fight-history.component.html',
  styleUrl: './fight-history.component.css',
})
export class FightHistoryComponent {
  protected readonly xpIcon = HEADER_ICON_XP_DATA_URI;
  protected readonly lootIcon = HEADER_ICON_LOOT_DATA_URI;

  private readonly stats = inject(StatsStoreService);
  private readonly classifier = inject(EntityClassifierService);
  private readonly classPickerService = inject(ClassPickerService);
  protected readonly i18n = inject(I18nService);

  private readonly expandedFightIds = signal<ReadonlySet<number>>(new Set());
  protected readonly lootSort = signal<LootSort>('name');
  /** Gemme grise au repos, cyan (`--accent`) une fois le tri par rareté actif — même logique que `.loot-sort-btn.active`. */
  protected readonly rarityIcon = computed(() =>
    this.lootSort() === 'rarity' ? RARITY_SORT_ICON_DATA_URI : RARITY_ICON_BASE_DATA_URI,
  );
  private readonly expandedFightXpIds = signal<ReadonlySet<number>>(new Set());
  private readonly expandedFightLootIds = signal<ReadonlySet<number>>(new Set());

  protected readonly fightHistory = this.stats.fightHistory;

  protected toggleFight(id: number): void {
    const next = new Set(this.expandedFightIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expandedFightIds.set(next);
  }

  protected isFightExpanded(id: number): boolean {
    return this.expandedFightIds().has(id);
  }

  protected toggleFightXp(id: number): void {
    const next = new Set(this.expandedFightXpIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expandedFightXpIds.set(next);
  }

  protected isFightXpExpanded(id: number): boolean {
    return this.expandedFightXpIds().has(id);
  }

  protected toggleFightLoot(id: number): void {
    const next = new Set(this.expandedFightLootIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expandedFightLootIds.set(next);
  }

  protected isFightLootExpanded(id: number): boolean {
    return this.expandedFightLootIds().has(id);
  }

  protected allyRowsFor(record: FightRecord): EntityDamageRow[] {
    return record.rows.filter((r) => this.classifier.classify(r.name) === 'ally');
  }

  protected enemyRowsFor(record: FightRecord): EntityDamageRow[] {
    return record.rows.filter((r) => this.classifier.classify(r.name) === 'enemy');
  }

  /** Ennemi ayant infligé le plus de dégâts durant ce combat (rows est déjà trié par total décroissant). */
  protected topEnemyFor(record: FightRecord): string | null {
    return this.enemyRowsFor(record)[0]?.name ?? null;
  }

  protected formatDuration(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes} ${this.i18n.t('damageMeter.minutes')} ${seconds}${this.i18n.t('damageMeter.seconds')}`;
  }

  protected setLootSort(mode: LootSort): void {
    this.lootSort.set(mode);
  }

  protected sortedLoot(loot: LootRow[]): LootRow[] {
    const sort = this.lootSort();
    if (sort === 'quantity') return [...loot].sort((a, b) => b.quantity - a.quantity);
    if (sort === 'rarity') {
      return [...loot].sort((a, b) => {
        const diff =
          RARITY_SORT_ORDER[getWakfuItemRarity(b.name)] -
          RARITY_SORT_ORDER[getWakfuItemRarity(a.name)];
        return diff !== 0 ? diff : a.name.localeCompare(b.name, 'fr');
      });
    }
    return [...loot].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  protected onLootContextMenu(event: MouseEvent, name: string): void {
    event.preventDefault();
    this.stats.addWatchedItem(name);
  }

  protected rarityClass(name: string): string {
    return `rarity-${getWakfuItemRarity(name)}`;
  }

  protected isWatched(name: string): boolean {
    return this.stats.isWatched(name);
  }

  protected onXpContextMenu(event: MouseEvent, name: string): void {
    event.preventDefault();
    this.classPickerService.open(name, event.clientX, event.clientY, (className, gender) => {
      this.classifier.setManualClass(name, className, gender);
    });
  }
}
