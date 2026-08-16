import { Component, computed, effect, inject, signal } from '@angular/core';
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
  FightImageLocalizedName,
  findDungeonForEnemies,
  resolveFightImageInfo,
  resolveFightTypeClassification,
} from '../../core/utils/fight-image.util';
import { LootSort, sortLootRows } from '../../core/utils/loot-sort.util';
import { CatalogService, isDungeonBreach } from '../../core/api/catalog.service';
import { HistoryArchiveService, HistoryOrigin } from '../../core/sync/history-archive.service';
import { DungeonHistoryEntry, groupDungeonRuns } from '../../core/utils/dungeon-run-grouping.util';
import { AuthService } from '../../core/auth/auth.service';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import {
  DamageViewMode,
  DamageViewSwitchComponent,
} from '../../shared/damage-view-switch/damage-view-switch.component';

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
    TooltipDirective,
    DamageViewSwitchComponent,
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
  protected readonly auth = inject(AuthService);

  /** Combats de la section "combat" (ally/enemy) actuellement DÉPLIÉS — vide par défaut, tout
   * REPLIÉ (même convention que `expandedDungeonRunIds` ci-dessous : un combat doit démarrer
   * fermé). Les collapses qu'un combat contient une fois déplié (alliés/ennemis via
   * `EntityDamageListComponent`, butin, XP — voir `collapsedFightXpIds`/`collapsedFightLootIds`
   * ci-dessous) gardent leur propre état par défaut (déplié), inchangé par cette convention. */
  private readonly expandedFightIds = signal<ReadonlySet<number>>(new Set());
  /** Switch Total/Tour (voir DamageViewSwitchComponent) — indexé par `id` de combat, indépendant
   * pour chaque combat déplié (plusieurs peuvent l'être simultanément, voir `expandedFightIds`) :
   * contrairement au combat en cours (un seul à la fois, voir DamageMeterComponent), il n'y a pas
   * ici de "combat affiché" unique auquel rattacher un état global. Absent de la map = 'total'
   * (comportement historique, aucun combat n'a de tour choisi par défaut). */
  private readonly fightViewModes = signal<ReadonlyMap<number, DamageViewMode>>(new Map());
  /** Tour choisi par combat — absent de la map = dernier tour du combat (le plus récent, repli
   * naturel pour un combat déjà terminé, voir `turnFor`). */
  private readonly fightTurns = signal<ReadonlyMap<number, number>>(new Map());
  protected readonly lootSort = signal<LootSort>('name');
  /** Toujours grise, que le tri par rareté soit actif ou non — seul le fond du bouton (pastille glissante) indique la sélection. */
  protected readonly rarityIcon = RARITY_ICON_BASE_DATA_URI;
  /** Sections XP/butin REPLIÉES par combat — vide par défaut, tout DÉPLIÉ (même convention que
   * `collapsedGroupKeys` plus bas) : contrairement à `expandedFightIds` ci-dessus, l'état par
   * défaut de ces sous-collapses n'a pas changé, seul le combat qui les contient démarre fermé. */
  private readonly collapsedFightXpIds = signal<ReadonlySet<number>>(new Set());
  private readonly collapsedFightLootIds = signal<ReadonlySet<number>>(new Set());
  /** Combats de donjon actuellement DÉPLIÉS (vide par défaut, tout REPLIÉ — à l'inverse de la
   * convention "vide = tout déplié" utilisée par `collapsedGroupKeys` ci-dessous : un regroupement
   * de donjon doit toujours démarrer fermé, voir CLAUDE.md), clé = `id` du combat représentatif (le
   * plus récent du run, voir `DungeonHistoryEntry.representative`), stable et unique. */
  private readonly expandedDungeonRunIds = signal<ReadonlySet<number>>(new Set());

  /** Combats affichés : session en cours + archive du compte fusionnées et dédoublonnées (voir
   * HistoryArchiveService.mergedFights). */
  protected readonly fightHistory = this.archive.mergedFights;

  /** Combats de donjon (salles + tentatives de boss) regroupés en entrées de collapse — voir
   * dungeon-run-grouping.util.ts. `fightHistory()` reste trié du plus récent au plus ancien,
   * `groupDungeonRuns` préserve cet ordre global (une entrée de donjon prend la position de son
   * combat le plus récent). */
  protected readonly historyEntries = computed<DungeonHistoryEntry<HistoryFight>[]>(() => {
    // Dépendance réactive explicite (même idiome qu'EntityClassifierService/EntityIconComponent) :
    // recalcule une fois le catalogue (donjons/monstres/familles) chargé ou rafraîchi en arrière-plan
    // — sans elle, un premier rendu avant la fin du chargement resterait figé sur des noms de
    // donjon/famille non résolus (voir CatalogService.findWakfuMonsterFamilyById, typeGroupLabel).
    this.catalog.revision();
    return groupDungeonRuns(
      this.fightHistory(),
      (record) =>
        findDungeonForEnemies(
          this.catalog,
          this.enemyRowsFor(record).map((row) => row.name),
        ),
      (record) => this.hasArchiEnemy(record),
    );
  });

  /** Regroupement (voir `FightGroupMode`) — Jour par défaut, comme toute liste de l'historique. */
  protected readonly groupMode = signal<FightGroupMode>('day');
  /** Clés de groupe actuellement repliées (vide par défaut, tout déplié — même convention que
   * `PurchasesComponent`/`TradesComponent`). Un `Set` de clés composites (`mode:key`) plutôt qu'un
   * `Set` de simples clés : changer de mode ne doit pas hériter du repli d'un autre regroupement. */
  private readonly collapsedGroupKeys = signal<ReadonlySet<string>>(new Set());

  private static readonly LOCATION_ORDER: readonly HistoryOrigin[] = ['session', 'account'];

  constructor() {
    // Le regroupement "Origine" (session/compte) n'a d'intérêt qu'en mode connecté — en invité, il
    // n'existe qu'une seule origine possible (la session en cours), voir `auth.isAuthenticated()`
    // dans le template. Repli sur "Jour" si l'utilisateur se déconnecte alors que ce mode était
    // actif : le bouton disparaît du switch, un mode sélectionné mais introuvable serait confus.
    effect(() => {
      if (this.groupMode() === 'location' && !this.auth.isAuthenticated()) {
        this.groupMode.set('day');
      }
    });
  }

  protected readonly fightGroups = computed<FightGroup[]>(() => {
    const mode = this.groupMode();
    const entries = this.historyEntries();
    if (mode === 'type') return this.buildTypeGroups(entries);

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

  /** Regroupement "Type" — voir `resolveFightTypeClassification` (fight-image.util.ts) pour la
   * classification par combat, et CLAUDE.md pour l'ordre de tri attendu (donjons par nombre de
   * salles/boss ultime/3 joueurs, puis brèches, puis familles de monstre, puis repli générique).
   * Deux passes nécessaires (contrairement à jour/lieu, voir `groupKeyFor` : clé+libellé s'y
   * calculent combat par combat) : le libellé d'un groupe "famille" ne peut être décidé qu'une fois
   * TOUS ses combats connus — voir `typeGroupLabel` (nom de famille réel si connu du catalogue,
   * sinon nom du monstre "représentatif" le PLUS FRÉQUENT au sein du groupe, en repli). */
  private buildTypeGroups(entries: DungeonHistoryEntry<HistoryFight>[]): FightGroup[] {
    interface TypeBucket {
      key: string;
      categoryRank: number;
      records: DungeonHistoryEntry<HistoryFight>[];
      /** Nom du donjon/brèche (groupe "dungeon") — labellisation immédiate, un seul nom possible. */
      dungeonNames: FightImageLocalizedName | null;
      /** Id de famille encyclopédie (groupe "famille" avec `family` connu, voir
       * `CatalogMonsterEntry.family`) — `null` pour un repli par nom (28 monstres sans famille) OU
       * un groupe qui n'est pas de type "famille". */
      familyId: number | null;
      /** Occurrences par nom de monstre "représentatif" (groupe "famille") — repli de labellisation
       * si `familyId` est `null` ou que son nom n'est pas (encore) connu du catalogue, voir doc de
       * `typeGroupLabel`. */
      nameCounts: Map<string, { names: FightImageLocalizedName; count: number }> | null;
    }
    const buckets = new Map<string, TypeBucket>();

    for (const entry of entries) {
      const record = this.representativeOf(entry);
      const classification = resolveFightTypeClassification(
        this.catalog,
        this.enemyRowsFor(record).map((row) => row.name),
      );

      let bucket = buckets.get(classification.key);
      if (!bucket) {
        bucket = {
          key: classification.key,
          categoryRank: classification.categoryRank,
          records: [],
          dungeonNames: classification.kind === 'dungeon' ? classification.names : null,
          familyId: classification.kind === 'family' ? classification.familyId : null,
          nameCounts: classification.kind === 'family' ? new Map() : null,
        };
        buckets.set(classification.key, bucket);
      }
      bucket.records.push(entry);

      if (bucket.nameCounts && classification.kind === 'family') {
        // `fr` sert de clé stable indépendante de la langue active (le libellé affiché, lui, suit
        // `this.i18n.locale()` — voir `typeGroupLabel`).
        const nameKey = classification.candidateNames.fr;
        const existing = bucket.nameCounts.get(nameKey);
        if (existing) existing.count++;
        else bucket.nameCounts.set(nameKey, { names: classification.candidateNames, count: 1 });
      }
    }

    return [...buckets.values()]
      .sort((a, b) => a.categoryRank - b.categoryRank) // tri stable : préserve l'ordre chronologique à rang égal
      .map((bucket) => ({
        key: bucket.key,
        label: this.typeGroupLabel(bucket),
        records: bucket.records,
      }));
  }

  /** Libellé d'un groupe "Type" : nom de donjon/brèche tel quel, sinon (groupe "famille") le VRAI
   * nom de famille localisé si `CatalogService` le connaît déjà (voir
   * `findWakfuMonsterFamilyById` — absent seulement si le cache n'a pas encore fini de charger
   * `/monster-families`, ou pour les 28 monstres sans famille encyclopédie), sinon en dernier repli
   * le nom de monstre "représentatif" le plus fréquent du groupe (voir `buildTypeGroups`). */
  private typeGroupLabel(bucket: {
    dungeonNames: FightImageLocalizedName | null;
    familyId: number | null;
    nameCounts: Map<string, { names: FightImageLocalizedName; count: number }> | null;
  }): string {
    if (bucket.dungeonNames) return bucket.dungeonNames[this.i18n.locale()];
    if (bucket.familyId !== null) {
      const family = this.catalog.findWakfuMonsterFamilyById(bucket.familyId);
      if (family) return family[this.i18n.locale()];
    }
    let best: { names: FightImageLocalizedName; count: number } | null = null;
    for (const candidate of bucket.nameCounts?.values() ?? []) {
      if (!best || candidate.count > best.count) best = candidate;
    }
    return best ? best.names[this.i18n.locale()] : this.i18n.t('history.group.otherType');
  }

  /** Combat représentatif d'une entrée d'historique pour le regroupement jour/lieu/type (date,
   * origine, image...) — le combat de boss/le plus récent pour un donjon, l'unique combat sinon. */
  protected representativeOf(entry: DungeonHistoryEntry<HistoryFight>): HistoryFight {
    return entry.kind === 'single' ? entry.record : entry.representative;
  }

  protected entryTrackId(entry: DungeonHistoryEntry<HistoryFight>): number {
    return this.representativeOf(entry).id;
  }

  private groupKeyFor(
    record: HistoryFight,
    mode: Exclude<FightGroupMode, 'type'>,
  ): { key: string; label: string } {
    if (mode === 'location') {
      const label = this.i18n.t(
        record.origin === 'session' ? 'history.group.session' : 'history.group.account',
      );
      return { key: record.origin, label };
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
   * récent du run) — toujours replié tant qu'il n'a pas été explicitement déplié une fois (voir
   * `expandedDungeonRunIds` ci-dessus, convention inversée par rapport à `collapsedGroupKeys`). */
  protected isDungeonRunCollapsed(representativeId: number): boolean {
    return !this.expandedDungeonRunIds().has(representativeId);
  }

  protected toggleDungeonRunCollapsed(representativeId: number): void {
    const next = new Set(this.expandedDungeonRunIds());
    if (next.has(representativeId)) next.delete(representativeId);
    else next.add(representativeId);
    this.expandedDungeonRunIds.set(next);
  }

  /** Nombre total de combats individuels d'un groupe jour/lieu/type — un run de donjon replié
   * compte pour tous ses combats, pas pour 1 seule "ligne" d'historique (voir `fightGroups`). Sert
   * de secours pour l'en-tête (voir `groupCountLabel`) hors du cas "groupe 100% donjons" ci-dessous. */
  protected groupFightCount(group: FightGroup): number {
    return group.records.reduce(
      (total, entry) => total + (entry.kind === 'single' ? 1 : entry.fights.length),
      0,
    );
  }

  /** Vrai si ce groupe (mode "type" uniquement — un groupe jour/lieu mélange librement donjons et
   * combats isolés, voir `groupKeyFor`) désigne un donjon plutôt qu'un monstre/famille classique —
   * déterminé sur le combat représentatif du premier run, le mode "type" garantissant que tous les
   * combats du groupe partagent la même identité (`resolveFightImageInfo`/`findDungeonForEnemies`). */
  private groupIsDungeonType(group: FightGroup): boolean {
    const representative = group.records[0] ? this.representativeOf(group.records[0]) : undefined;
    if (!representative) return false;
    return (
      findDungeonForEnemies(
        this.catalog,
        this.enemyRowsFor(representative).map((row) => row.name),
      ) !== null
    );
  }

  /** Texte du compteur affiché dans l'en-tête d'un groupe jour/lieu/type. Pour un groupe "type" de
   * donjon (multi-salles), le nombre de COMBATS individuels regonfle artificiellement le total
   * (ex. 4 runs de 4 salles = "16 combats" affichés pour seulement 4 donjons réellement joués, bug
   * corrigé ici) : dans ce cas précis, chaque entrée du groupe (run complet OU combat de boss isolé
   * en cas d'historique incomplet) compte pour 1 SEUL donjon plutôt que pour ses salles internes. Le
   * détail "N combats - durée" à l'intérieur d'un run déplié (voir template) reste, lui, un vrai
   * décompte de combats — inchangé. */
  protected groupCountLabel(group: FightGroup): string {
    if (this.groupMode() === 'type' && this.groupIsDungeonType(group)) {
      const count = group.records.length;
      return this.i18n.t(
        count === 1 ? 'history.group.dungeonCount' : 'history.group.dungeonCountPlural',
        { count },
      );
    }
    return this.fightCountLabel(this.groupFightCount(group));
  }

  protected fightCountLabel(count: number): string {
    return this.i18n.t(
      count === 1 ? 'history.group.fightCount' : 'history.group.fightCountPlural',
      {
        count,
      },
    );
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

  protected viewModeFor(id: number): DamageViewMode {
    return this.fightViewModes().get(id) ?? 'total';
  }

  protected setViewMode(id: number, mode: DamageViewMode): void {
    const next = new Map(this.fightViewModes());
    next.set(id, mode);
    this.fightViewModes.set(next);
  }

  protected turnFor(record: FightRecord): number {
    return Math.min(this.fightTurns().get(record.id) ?? record.turns, Math.max(1, record.turns));
  }

  protected setTurn(record: FightRecord, turn: number): void {
    const next = new Map(this.fightTurns());
    next.set(record.id, Math.min(Math.max(1, turn), Math.max(1, record.turns)));
    this.fightTurns.set(next);
  }

  protected toggleFightXp(id: number): void {
    const next = new Set(this.collapsedFightXpIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.collapsedFightXpIds.set(next);
  }

  protected isFightXpExpanded(id: number): boolean {
    return !this.collapsedFightXpIds().has(id);
  }

  protected toggleFightLoot(id: number): void {
    const next = new Set(this.collapsedFightLootIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.collapsedFightLootIds.set(next);
  }

  protected isFightLootExpanded(id: number): boolean {
    return !this.collapsedFightLootIds().has(id);
  }

  protected allyRowsFor(record: FightRecord): EntityDamageRow[] {
    return record.rows.filter((r) => this.classifier.classify(r.name) === 'ally');
  }

  protected enemyRowsFor(record: FightRecord): EntityDamageRow[] {
    return record.rows.filter((r) => this.classifier.classify(r.name) === 'enemy');
  }

  /** Vrai si un archimonstre (`CatalogMonsterEntry.isArchi`) figure parmi les ennemis du combat —
   * utilisé par `groupDungeonRuns` pour n'ajouter le créneau "archimonstre pré-boss" que lorsqu'il
   * est réellement présent (voir dungeon-run-grouping.util.ts, `hasPreBossArchi`). */
  private hasArchiEnemy(record: HistoryFight): boolean {
    return this.enemyRowsFor(record).some(
      (row) => this.catalog.findWakfuMonsterEntry(row.name)?.isArchi === true,
    );
  }

  /** Illustration du combat (boss de donjon / archi / dominant / plus gros dégât), voir
   * resolveFightImageInfo. `isDungeonBossRow` (voir template) force l'illustration propre du boss
   * plutôt que celle du donjon pour la ligne de boss À L'INTÉRIEUR d'un regroupement déjà déplié
   * (l'image du donjon est déjà portée par l'en-tête du regroupement, voir template). */
  protected fightImageUrl(record: FightRecord, isDungeonBossRow = false): string | null {
    return resolveFightImageInfo(
      this.catalog,
      this.enemyRowsFor(record).map((row) => row.name),
      isDungeonBossRow,
    ).url;
  }

  /** Tooltip nom du donjon/monstre associé à l'illustration, ou `null` (brèche/illustration générique) — voir resolveFightImageInfo. */
  protected fightImageTooltip(record: FightRecord, isDungeonBossRow = false): string | null {
    const source = resolveFightImageInfo(
      this.catalog,
      this.enemyRowsFor(record).map((row) => row.name),
      isDungeonBossRow,
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
  protected dungeonRunTooltip(
    entry: Extract<DungeonHistoryEntry<HistoryFight>, { kind: 'dungeonRun' }>,
  ): string | null {
    return isDungeonBreach(entry.dungeon) ? null : entry.dungeon[this.i18n.locale()];
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
