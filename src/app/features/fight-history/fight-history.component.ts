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
import { TranslatePipe } from '../../shared/translate.pipe';
import { LootListComponent } from '../../shared/loot-list/loot-list.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { I18nService } from '../../core/services/i18n.service';
import {
  HEADER_ICON_LOOT_DATA_URI,
  HEADER_ICON_XP_DATA_URI,
} from '../../core/data/header-icons.data';
import { RARITY_ICON_BASE_DATA_URI } from '../../core/data/rarity-icon.data';
import { DEFAULT_FIGHT_IMAGE_URL, resolveFightImageInfo } from '../../core/utils/fight-image.util';
import { LootSort, sortLootRows } from '../../core/utils/loot-sort.util';
import { CatalogService } from '../../core/api/catalog.service';
import { HistoryArchiveService } from '../../core/sync/history-archive.service';

/**
 * Historique des combats (liste repliable, butin, XP) — extrait de
 * DamageMeterComponent pour être affiché comme sous-onglet "Combats" de la
 * nouvelle section Historique (voir HistoryComponent), à côté des achats.
 * Rendu directement au niveau du `.tool-panel` parent (`:host{display:contents}`),
 * même principe que PurchasesComponent.
 */
@Component({
  selector: 'app-fight-history',
  imports: [
    NumberFrPipe,
    EntityDamageListComponent,
    EntityIconComponent,
    TranslatePipe,
    LootListComponent,
    IconComponent,
  ],
  templateUrl: './fight-history.component.html',
  styleUrl: './fight-history.component.css',
})
export class FightHistoryComponent {
  protected readonly xpIcon = HEADER_ICON_XP_DATA_URI;
  protected readonly lootIcon = HEADER_ICON_LOOT_DATA_URI;

  private readonly stats = inject(StatsStoreService);
  private readonly archive = inject(HistoryArchiveService);
  private readonly classifier = inject(EntityClassifierService);
  private readonly classPickerService = inject(ClassPickerService);
  protected readonly i18n = inject(I18nService);
  private readonly catalog = inject(CatalogService);

  private readonly expandedFightIds = signal<ReadonlySet<number>>(new Set());
  protected readonly lootSort = signal<LootSort>('name');
  /** Toujours grise, que le tri par rareté soit actif ou non — seul le fond du bouton (pastille glissante) indique la sélection. */
  protected readonly rarityIcon = RARITY_ICON_BASE_DATA_URI;
  private readonly expandedFightXpIds = signal<ReadonlySet<number>>(new Set());
  private readonly expandedFightLootIds = signal<ReadonlySet<number>>(new Set());

  /** Combats affichés : session en cours (fichier de log) ou archive du compte
   * (lot 8) selon la source choisie dans l'en-tête de la section Historique. */
  protected readonly fightHistory = computed<readonly FightRecord[]>(() =>
    this.archive.showsAccount() ? this.archive.fights() : this.stats.fightHistory(),
  );

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

  /** Illustration du combat (boss de donjon / archi / dominant / plus gros dégât), voir resolveFightImageInfo. */
  protected fightImageUrl(record: FightRecord): string | null {
    return resolveFightImageInfo(
      this.catalog,
      this.enemyRowsFor(record).map((row) => row.name),
    ).url;
  }

  /** Tooltip nom du donjon/monstre associé à l'illustration, ou `null` (brèche/illustration générique) — voir resolveFightImageInfo. */
  protected fightImageTooltip(record: FightRecord): string | null {
    const source = resolveFightImageInfo(
      this.catalog,
      this.enemyRowsFor(record).map((row) => row.name),
    ).tooltipSource;
    return source ? source.names[this.i18n.locale()] : null;
  }

  protected onFightImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img.src !== DEFAULT_FIGHT_IMAGE_URL) img.src = DEFAULT_FIGHT_IMAGE_URL;
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
    return sortLootRows(this.catalog, loot, this.lootSort());
  }

  protected onXpContextMenu(event: MouseEvent, name: string): void {
    event.preventDefault();
    this.classPickerService.open(name, event.clientX, event.clientY, (className, gender) => {
      this.classifier.setManualClass(name, className, gender);
    });
  }
}
