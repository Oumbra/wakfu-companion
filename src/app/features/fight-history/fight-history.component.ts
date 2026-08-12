import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
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
import {
  DEFAULT_FIGHT_IMAGE_URL,
  findDungeonForEnemies,
  resolveFightImageInfo,
} from '../../core/utils/fight-image.util';
import { LootSort, sortLootRows } from '../../core/utils/loot-sort.util';
import { CatalogService } from '../../core/api/catalog.service';
import { HistoryArchiveService, HistoryOrigin } from '../../core/sync/history-archive.service';
import { DungeonHistoryEntry, groupDungeonRuns } from '../../core/utils/dungeon-run-grouping.util';

export type FightGroupMode = 'day' | 'location' | 'type';

type HistoryFight = FightRecord & { origin: HistoryOrigin };

interface FightGroup {
  /** Identifiant stable non traduit (date ISO courte / 'session' / 'account' / nom de type) —
   * sert de clé de tracking et de clé de repli, jamais affiché tel quel. */
  key: string;
  label: string;
  records: DungeonHistoryEntry<HistoryFight>[];
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
    NgTemplateOutlet,
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
  /** Combats de donjon actuellement repliés (vide par défaut, tout déplié — même convention que
   * `collapsedGroupKeys` ci-dessous), clé = `id` du combat représentatif (le plus récent du run,
   * voir `DungeonHistoryEntry.representative`), stable et unique. */
  private readonly collapsedDungeonRunIds = signal<ReadonlySet<number>>(new Set());

  /** Combats affichés : session en cours + archive du compte fusionnées et dédoublonnées (voir
   * HistoryArchiveService.mergedFights). */
  protected readonly fightHistory = this.archive.mergedFights;

  /** Combats de donjon (salles + tentatives de boss) regroupés en entrées de collapse — voir
   * dungeon-run-grouping.util.ts. `fightHistory()` reste trié du plus récent au plus ancien,
   * `groupDungeonRuns` préserve cet ordre global (une entrée de donjon prend la position de son
   * combat le plus récent). */
  protected readonly historyEntries = computed<DungeonHistoryEntry<HistoryFight>[]>(() =>
    groupDungeonRuns(this.fightHistory(), (record) =>
      findDungeonForEnemies(
        this.catalog,
        this.enemyRowsFor(record).map((row) => row.name),
      ),
    ),
  );

  /** Regroupement (voir `FightGroupMode`) — Jour par défaut, comme toute liste de l'historique. */
  protected readonly groupMode = signal<FightGroupMode>('day');
  /** Clés de groupe actuellement repliées (vide par défaut, tout déplié — même convention que
   * `PurchasesComponent`/`TradesComponent`). Un `Set` de clés composites (`mode:key`) plutôt qu'un
   * `Set` de simples clés : changer de mode ne doit pas hériter du repli d'un autre regroupement. */
  private readonly collapsedGroupKeys = signal<ReadonlySet<string>>(new Set());

  private static readonly LOCATION_ORDER: readonly HistoryOrigin[] = ['session', 'account'];

  protected readonly fightGroups = computed<FightGroup[]>(() => {
    const mode = this.groupMode();
    const entries = this.historyEntries();
    const groups = new Map<string, FightGroup>();
    for (const entry of entries) {
      const { key, label } = this.groupKeyFor(this.representativeOf(entry), mode);
      const existing = groups.get(key);
      if (existing) existing.records.push(entry);
      else groups.set(key, { key, label, records: [entry] });
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

  /** Combat représentatif d'une entrée d'historique pour le regroupement jour/lieu/type (date,
   * origine, image...) — le combat de boss/le plus récent pour un donjon, l'unique combat sinon. */
  protected representativeOf(entry: DungeonHistoryEntry<HistoryFight>): HistoryFight {
    return entry.kind === 'single' ? entry.record : entry.representative;
  }

  protected entryTrackId(entry: DungeonHistoryEntry<HistoryFight>): number {
    return this.representativeOf(entry).id;
  }

  private groupKeyFor(record: HistoryFight, mode: FightGroupMode): { key: string; label: string } {
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
    const label = this.i18n.formatRelativeDay(record.fullTimestampMs);
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

  /** État de repli d'un collapse de donjon, indexé par `id` du combat représentatif (le plus
   * récent du run) — même convention "vide = tout déplié" que `collapsedGroupKeys` ci-dessus. */
  protected isDungeonRunCollapsed(representativeId: number): boolean {
    return this.collapsedDungeonRunIds().has(representativeId);
  }

  protected toggleDungeonRunCollapsed(representativeId: number): void {
    const next = new Set(this.collapsedDungeonRunIds());
    if (next.has(representativeId)) next.delete(representativeId);
    else next.add(representativeId);
    this.collapsedDungeonRunIds.set(next);
  }

  /** Nombre total de combats individuels d'un groupe jour/lieu/type — un run de donjon replié
   * compte pour tous ses combats, pas pour 1 seule "ligne" d'historique (voir `fightGroups`). */
  protected groupFightCount(group: FightGroup): number {
    return group.records.reduce(
      (total, entry) => total + (entry.kind === 'single' ? 1 : entry.fights.length),
      0,
    );
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

  /** Tooltip nom du donjon pour l'en-tête d'un collapse de donjon — `null` pour une brèche (même
   * règle que `fightImageTooltip`/resolveFightImageInfo, aucun donjon multi-salles n'est en
   * pratique une brèche mais autant rester cohérent). */
  protected dungeonRunTooltip(entry: Extract<DungeonHistoryEntry<HistoryFight>, { kind: 'dungeonRun' }>): string | null {
    return entry.dungeon.isBreach ? null : entry.dungeon[this.i18n.locale()];
  }

  /** Durée totale d'un run de donjon (somme des combats qui le composent, victoires et défaites
   * comprises — voir CLAUDE.md). */
  protected dungeonRunDurationMs(
    entry: Extract<DungeonHistoryEntry<HistoryFight>, { kind: 'dungeonRun' }>,
  ): number {
    return entry.fights.reduce((total, fight) => total + fight.durationMs, 0);
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
