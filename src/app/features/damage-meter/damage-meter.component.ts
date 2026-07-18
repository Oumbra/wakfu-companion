import { Component, computed, inject, signal } from '@angular/core';
import {
  EntityDamageRow,
  FightRecord,
  LootRow,
  StatsStoreService,
} from '../../core/services/stats-store.service';
import { EntityClassifierService } from '../../core/services/entity-classifier.service';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { EntityDamageListComponent } from './entity-damage-list/entity-damage-list.component';
import { EntityIconComponent } from '../../shared/entity-icon/entity-icon.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { HEADER_ICON_DAMAGE_DATA_URI, HEADER_ICON_XP_DATA_URI } from '../../core/data/header-icons.data';

type MeterView = 'current' | 'history';
type LootSort = 'name' | 'quantity';

@Component({
  selector: 'app-damage-meter',
  imports: [
    NumberFrPipe,
    EntityDamageListComponent,
    EntityIconComponent,
    ItemIconComponent,
    TranslatePipe,
  ],
  templateUrl: './damage-meter.component.html',
  styleUrl: './damage-meter.component.css',
})
export class DamageMeterComponent {
  protected readonly headerIcon = HEADER_ICON_DAMAGE_DATA_URI;
  protected readonly xpIcon = HEADER_ICON_XP_DATA_URI;

  private readonly stats = inject(StatsStoreService);
  private readonly classifier = inject(EntityClassifierService);
  protected readonly i18n = inject(I18nService);

  protected readonly view = signal<MeterView>('current');
  private readonly expandedFightIds = signal<ReadonlySet<number>>(new Set());
  protected readonly lootSort = signal<LootSort>('name');
  private readonly expandedFightXpIds = signal<ReadonlySet<number>>(new Set());

  protected readonly allyRows = computed<EntityDamageRow[]>(() =>
    this.stats.damageByAttacker().filter((r) => this.classifier.classify(r.name) === 'ally'),
  );
  protected readonly enemyRows = computed<EntityDamageRow[]>(() =>
    this.stats.damageByAttacker().filter((r) => this.classifier.classify(r.name) === 'enemy'),
  );
  protected readonly hasCurrentFight = computed(
    () => this.allyRows().length > 0 || this.enemyRows().length > 0,
  );

  protected readonly fightHistory = this.stats.fightHistory;
  protected readonly currentFightTurns = this.stats.currentFightTurns;
  protected readonly currentFightDurationMs = this.stats.currentFightDurationMs;

  protected setView(view: MeterView): void {
    this.view.set(view);
  }

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
    return this.lootSort() === 'quantity'
      ? [...loot].sort((a, b) => b.quantity - a.quantity)
      : [...loot].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  protected onLootContextMenu(event: MouseEvent, name: string): void {
    event.preventDefault();
    this.stats.addWatchedItem(name);
  }
}
