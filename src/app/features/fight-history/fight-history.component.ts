import { Component, computed, inject, signal } from '@angular/core';
import { EntityDamageRow, FightRecord, LootRow } from '../../core/services/stats-store.service';
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
import { HistoryArchiveService, HistoryOrigin } from '../../core/sync/history-archive.service';

export type FightGroupMode = 'day' | 'location' | 'type';

interface FightGroup {
  /** Identifiant stable non traduit (date ISO courte / 'session' / 'account' / nom de type) —
   * sert de clé de tracking et de clé de repli, jamais affiché tel quel. */
  key: string;
  label: string;
  records: (FightRecord & { origin: HistoryOrigin })[];
}

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

  /** Combats affichés : session en cours + archive du compte fusionnées et dédoublonnées (voir
   * HistoryArchiveService.mergedFights). */
  protected readonly fightHistory = this.archive.mergedFights;

  /** Regroupement (voir `FightGroupMode`) — Jour par défaut, comme toute liste de l'historique. */
  protected readonly groupMode = signal<FightGroupMode>('day');
  /** Clés de groupe actuellement repliées (vide par défaut, tout déplié — même convention que
   * `PurchasesComponent`/`TradesComponent`). Un `Set` de clés composites (`mode:key`) plutôt qu'un
   * `Set` de simples clés : changer de mode ne doit pas hériter du repli d'un autre regroupement. */
  private readonly collapsedGroupKeys = signal<ReadonlySet<string>>(new Set());

  private static readonly LOCATION_ORDER: readonly HistoryOrigin[] = ['session', 'account'];

  protected readonly fightGroups = computed<FightGroup[]>(() => {
    const mode = this.groupMode();
    const records = this.fightHistory();
    const groups = new Map<string, FightGroup>();
    for (const record of records) {
      const { key, label } = this.groupKeyFor(record, mode);
      const existing = groups.get(key);
      if (existing) existing.records.push(record);
      else groups.set(key, { key, label, records: [record] });
    }
    const list = [...groups.values()];
    if (mode === 'location') {
      list.sort(
        (a, b) =>
          FightHistoryComponent.LOCATION_ORDER.indexOf(a.key as HistoryOrigin) -
          FightHistoryComponent.LOCATION_ORDER.indexOf(b.key as HistoryOrigin),
      );
    }
    return list;
  });

  private groupKeyFor(
    record: FightRecord & { origin: HistoryOrigin },
    mode: FightGroupMode,
  ): { key: string; label: string } {
    if (mode === 'location') {
      const label = this.i18n.t(
        record.origin === 'session' ? 'history.group.session' : 'history.group.account',
      );
      return { key: record.origin, label };
    }
    if (mode === 'type') {
      const info = resolveFightImageInfo(
        this.catalog,
        this.enemyRowsFor(record).map((row) => row.name),
      );
      const label = info.tooltipSource
        ? info.tooltipSource.names[this.i18n.locale()]
        : this.i18n.t('history.group.otherType');
      return { key: label, label };
    }
    const label = this.i18n.formatDate(record.fullTimestampMs);
    return { key: label, label };
  }

  protected setGroupMode(mode: FightGroupMode): void {
    this.groupMode.set(mode);
  }

  protected isGroupCollapsed(groupKey: string): boolean {
    return this.collapsedGroupKeys().has(`${this.groupMode()}:${groupKey}`);
  }

  protected toggleGroupCollapsed(groupKey: string): void {
    const compositeKey = `${this.groupMode()}:${groupKey}`;
    const next = new Set(this.collapsedGroupKeys());
    if (next.has(compositeKey)) next.delete(compositeKey);
    else next.add(compositeKey);
    this.collapsedGroupKeys.set(next);
  }

  protected fightCountLabel(count: number): string {
    return this.i18n.t(count === 1 ? 'history.group.fightCount' : 'history.group.fightCountPlural', {
      count,
    });
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
