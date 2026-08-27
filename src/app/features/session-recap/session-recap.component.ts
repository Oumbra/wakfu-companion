import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  LootRow,
  SESSION_LIVE_TICK_GRACE_MS,
  StatsStoreService,
} from '../../core/services/stats-store.service';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { EntityIconComponent } from '../../shared/entity-icon/entity-icon.component';
import { LootListComponent } from '../../shared/loot-list/loot-list.component';
import { EntityClassifierService } from '../../core/services/entity-classifier.service';
import { ClassPickerService } from '../../core/services/class-picker.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { DashboardLayoutService } from '../../core/services/dashboard-layout.service';
import {
  HEADER_ICON_CHALLENGES_DATA_URI,
  HEADER_ICON_COMBAT_DATA_URI,
  HEADER_ICON_KAMAS_DATA_URI,
  HEADER_ICON_LOOT_DATA_URI,
  HEADER_ICON_XP_DATA_URI,
} from '../../core/data/header-icons.data';
import { RARITY_ICON_BASE_DATA_URI } from '../../core/data/rarity-icon.data';
import {
  LootSort,
  lootSortTooltip as computeLootSortTooltip,
  nextLootSortState,
  sortLootRows,
} from '../../core/utils/loot-sort.util';
import { CatalogService, WakfuDungeonType } from '../../core/api/catalog.service';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { AuthService } from '../../core/auth/auth.service';
import {
  HistoryStatsService,
  PeriodGroupTotals,
  PeriodStats,
} from '../../core/sync/history-stats.service';
import { resolveItemName } from '../../core/sync/history-archive.service';
import { PeriodGranularity, periodBounds } from '../../core/utils/local-period.util';
import { mergeGroupTotals } from '../../core/utils/period-group-merge.util';
import { StepperComponent } from '../../shared/stepper/stepper.component';
import { PeriodPickerService } from '../../core/services/period-picker.service';

/** Granularité du switch Session/Jour/Mois/Année — voir `setGranularity`. `'session'` (défaut)
 * reste piloté par `StatsStoreService` (contenu du fichier connecté, inchangé) ; les trois autres
 * agrègent côté compte via `HistoryStatsService` (voir `functions/api/v1/history/stats.ts`), donc
 * uniquement pertinentes pour un utilisateur connecté (voir template, `auth.isAuthenticated()`). */
type Granularity = 'session' | PeriodGranularity;

/** Borne basse (en pas de `periodOffset`, voir `setGranularity`/`onOffsetChange`) du stepper de
 * navigation par granularité — garde-fou UI généreux plutôt qu'une vraie limite fonctionnelle (une
 * période sans donnée s'affiche simplement à zéro, elle ne produit jamais d'erreur) : borne le
 * nombre de clics utiles avant de basculer sur une granularité plus large. */
const OFFSET_MIN: Record<PeriodGranularity, number> = {
  day: -3650, // ~10 ans
  month: -120, // 10 ans
  year: -50,
};

/** Mode d'affichage du détail Jour/Mois/Année (voir `detailMode`) — `'cumulative'` (défaut, switch
 * réinitialisé à chaque changement de granularité) reproduit exactement l'ancien affichage (XP/
 * Kamas/Combats/Butin globaux de la période) ; `'byGroup'`/`'byType'` le REMPLACENT par une liste
 * accordéon (voir `activeGroupRows`) plutôt que de s'y ajouter. */
type DetailMode = 'cumulative' | 'byGroup' | 'byType';

/** Ordre d'itération stable des 8 `WakfuDungeonType` pour le mode "Type" — voir `typeRows`. */
const DUNGEON_TYPES: readonly WakfuDungeonType[] = [
  'TWO_ROOMS',
  'THREE_ROOMS',
  'FOUR_ROOMS',
  'THREE_PLAYERS',
  'ULTIMATE_BOSS',
  'BREACH',
  'ULTIMATE_BREACH',
  'ARCADE',
];

const DUNGEON_TYPE_KEY: Record<WakfuDungeonType, string> = {
  TWO_ROOMS: 'sessionRecap.period.dungeonType.twoRooms',
  THREE_ROOMS: 'sessionRecap.period.dungeonType.threeRooms',
  FOUR_ROOMS: 'sessionRecap.period.dungeonType.fourRooms',
  THREE_PLAYERS: 'sessionRecap.period.dungeonType.threePlayers',
  ULTIMATE_BOSS: 'sessionRecap.period.dungeonType.ultimateBoss',
  BREACH: 'sessionRecap.period.dungeonType.breach',
  ULTIMATE_BREACH: 'sessionRecap.period.dungeonType.ultimateBreach',
  ARCADE: 'sessionRecap.period.dungeonType.arcade',
};

/** Ligne unifiée de l'accordéon "Donjon & Famille"/"Type" (voir `groupRows`/`typeRows`) — `key`
 * sert au `track` du `@for` ET à l'état déplié/replié (`expandedGroups`), `totals` porte les
 * agrégats propres à CE groupe (voir `PeriodGroupTotals`), déjà résolus côté serveur. */
interface RecapGroupRow {
  key: string;
  label: string;
  totals: PeriodGroupTotals;
  /** URL de l'illustration officielle Ankama du donjon (voir `CatalogDungeonEntry.pictureUrl`),
   * uniquement pour une ligne "Donjon & Famille" adossée à un VRAI donjon résolu — `null` pour une
   * ligne famille (aucune image par famille côté catalogue, voir `CatalogMonsterFamilyEntry`) et
   * pour toute ligne du mode "Type" (bucket fusionné, plusieurs donjons possibles derrière une
   * seule ligne — pas d'image unique pertinente, voir `typeRows`). Le template retombe alors sur
   * un pictogramme générique (voir `isFamilyRow`). */
  pictureUrl: string | null;
}

/**
 * Carte du dashboard "Récap de session" — au même titre que Combats/Achats/Échanges/Chat (voir
 * DashboardLayoutService/DashboardBodySlotKey), pas une fenêtre flottante déplaçable comme
 * auparavant (voir CLAUDE.md). Ce composant n'est monté dans le DOM QUE quand la carte n'est pas
 * repliée (voir
 * `dashboard.component.html`, même principe que les panneaux scindés d'`HistoryComponent`) — pas
 * besoin d'un service `isOpen`/`open`/`close` séparé comme auparavant (`SessionRecapService`,
 * supprimé), le cycle de vie Angular standard (`OnInit`/`OnDestroy`) suffit à piloter le ticker de
 * durée.
 */
@Component({
  selector: 'app-session-recap',
  imports: [
    NumberFrPipe,
    TranslatePipe,
    EntityIconComponent,
    LootListComponent,
    TooltipDirective,
    IconComponent,
    StepperComponent,
  ],
  templateUrl: './session-recap.component.html',
  styleUrl: './session-recap.component.css',
})
export class SessionRecapComponent implements OnInit, OnDestroy {
  protected readonly xpIcon = HEADER_ICON_XP_DATA_URI;
  protected readonly kamasIcon = HEADER_ICON_KAMAS_DATA_URI;
  protected readonly combatIcon = HEADER_ICON_COMBAT_DATA_URI;
  protected readonly challengesIcon = HEADER_ICON_CHALLENGES_DATA_URI;
  protected readonly lootIcon = HEADER_ICON_LOOT_DATA_URI;
  /** Toujours grise, que le tri par rareté soit actif ou non — voir FightHistoryComponent (même switch). */
  protected readonly rarityIcon = RARITY_ICON_BASE_DATA_URI;

  protected readonly stats = inject(StatsStoreService);
  private readonly catalog = inject(CatalogService);
  protected readonly i18n = inject(I18nService);
  protected readonly layout = inject(DashboardLayoutService);
  private readonly classifier = inject(EntityClassifierService);
  private readonly classPickerService = inject(ClassPickerService);
  protected readonly auth = inject(AuthService);
  protected readonly historyStats = inject(HistoryStatsService);
  private readonly periodPickerService = inject(PeriodPickerService);
  /** Instanciée directement (pas d'injection : `NumberFrPipe` n'a aucune dépendance) pour formater
   * un nombre depuis TypeScript — voir `kamasTooltip`, seul endroit de ce composant où le formatage
   * ne peut pas passer par le pipe `| numberFr` du template (texte composite, voir sa doc). */
  private readonly numberFr = new NumberFrPipe();

  protected readonly granularity = signal<Granularity>('session');
  /** Pas courant dans le stepper de navigation par période — `0` = période EN COURS (jour/mois/
   * année contenant maintenant), négatif = passé (voir `periodBounds`). Toujours réinitialisé à
   * `0` par `setGranularity` : changer de granularité repart de la période courante. */
  protected readonly periodOffset = signal(0);

  /** Mode d'affichage du détail (voir `DetailMode`) — réinitialisé à `'cumulative'` par
   * `setGranularity`, même logique que `periodOffset` : changer de granularité repart toujours du
   * mode Cumulé. */
  protected readonly detailMode = signal<DetailMode>('cumulative');
  /** Clés (`RecapGroupRow.key`) actuellement dépliées dans l'accordéon "Donjon & Famille"/"Type" —
   * un `Set` plutôt que des booléens fixes par ligne : les lignes elles-mêmes sont dynamiques
   * (dépendent des données de la période chargée), pas une liste connue à l'avance. */
  protected readonly expandedGroups = signal<ReadonlySet<string>>(new Set());
  /** Clés (`RecapGroupRow.key`) dont la vignette (`row.pictureUrl`) a échoué au chargement (image
   * absente côté CDN Ankama pour cet id) — bascule alors sur le pictogramme générique, voir
   * `onThumbError`/template. Jamais vidé : un échec de chargement reste un échec pour le reste de
   * la session, pas besoin de retenter. */
  protected readonly failedThumbs = signal<ReadonlySet<string>>(new Set());

  @ViewChild('xpList') private readonly xpListRef?: ElementRef<HTMLDivElement>;

  protected readonly duration = signal('00:00:00');
  protected readonly kamasExpanded = signal(false);
  /** Combat et expérience ouverts par défaut (le butin, imbriqué sous "Combats" ci-dessous, en
   * bénéficie du même coup) — seul Kamas reste replié par défaut. */
  protected readonly xpExpanded = signal(true);
  protected readonly combatsExpanded = signal(true);
  protected readonly lootSort = signal<LootSort>('name');
  /** Sens du tri courant (`false` = sens par défaut de `lootSort`) — inversé au reclic sur le
   * switch déjà actif, voir `nextLootSortState`. */
  protected readonly lootSortReverse = signal(false);

  private tickInterval: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.updateDuration();
    this.tickInterval = setInterval(() => this.updateDuration(), 1000);
  }

  ngOnDestroy(): void {
    if (this.tickInterval !== null) clearInterval(this.tickInterval);
  }

  toggleKamas(): void {
    this.kamasExpanded.update((v) => !v);
  }

  toggleXp(): void {
    const next = !this.xpExpanded();
    this.xpExpanded.set(next);
    if (!next) {
      // Revenir replié doit toujours remontrer les 3 premiers (liste déjà
      // triée par XP décroissante) : on réinitialise le scroll éventuel.
      queueMicrotask(() => {
        if (this.xpListRef) this.xpListRef.nativeElement.scrollTop = 0;
      });
    }
  }

  toggleCombats(): void {
    this.combatsExpanded.update((v) => !v);
  }

  protected setLootSort(mode: LootSort): void {
    const next = nextLootSortState(this.lootSort(), this.lootSortReverse(), mode);
    this.lootSort.set(next.sort);
    this.lootSortReverse.set(next.reverse);
  }

  protected sortedLoot(): LootRow[] {
    return sortLootRows(
      this.catalog,
      this.stats.sessionLoot(),
      this.lootSort(),
      this.lootSortReverse(),
    );
  }

  protected lootSortTooltip(mode: LootSort): string {
    return computeLootSortTooltip(this.i18n, this.lootSort(), this.lootSortReverse(), mode);
  }

  /** Change de granularité : repart toujours de la période EN COURS (`periodOffset` à `0`), même
   * si l'utilisateur avait navigué dans le passé sur la granularité précédente — changer de
   * granularité et naviguer sont deux gestes distincts, mélanger les deux surprendrait plus qu'autre
   * chose (« je clique sur Mois, je m'attends au mois EN COURS, pas à un mois arbitraire hérité du
   * dernier `periodOffset` laissé sur Jour »). */
  protected setGranularity(next: Granularity): void {
    this.granularity.set(next);
    this.periodOffset.set(0);
    this.detailMode.set('cumulative');
    if (next === 'session') return;
    this.loadPeriod(next, 0);
  }

  /** Callback du stepper de navigation (‹ précédent / suivant ›, voir template) ET du mini
   * calendrier (`PeriodPickerService`/`openPeriodPicker`) — émis déjà borné à [OFFSET_MIN, 0] par
   * l'un comme par l'autre. */
  protected onOffsetChange(next: number): void {
    this.periodOffset.set(next);
    const g = this.granularity();
    if (g === 'session') return; // stepper masqué en session, ne devrait jamais être atteint
    this.loadPeriod(g, next);
  }

  /** Ouvre le mini calendrier de navigation (icône 📅, voir template) ancré sur le bouton cliqué —
   * même principe que `onXpNameContextMenu`/`ClassPickerService` (rendu au niveau racine, voir
   * CLAUDE.md "position: fixed niché dans un ancêtre transform"). */
  protected openPeriodPicker(event: MouseEvent): void {
    const g = this.granularity();
    if (g === 'session') return; // bouton masqué en session, ne devrait jamais être atteint
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.periodPickerService.open(
      g,
      this.periodOffset(),
      this.offsetMin(),
      rect.left,
      rect.bottom + 4,
      (offset) => this.onOffsetChange(offset),
    );
  }

  /** Change le mode d'affichage du détail (voir `DetailMode`) — ne touche ni à la granularité ni à
   * `periodOffset` : rester sur la même période en changeant seulement comment elle est ventilée. */
  protected setDetailMode(mode: DetailMode): void {
    this.detailMode.set(mode);
  }

  protected toggleGroup(key: string): void {
    this.expandedGroups.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected isGroupExpanded(key: string): boolean {
    return this.expandedGroups().has(key);
  }

  /** Vrai pour une ligne "famille de monstre" (voir `groupRows`) OU pour le bucket "Autres" du
   * mode "Type" (`typeRows`, qui fusionne TOUTE `period.families`) — sert au template à choisir le
   * pictogramme générique de repli (silhouette de créature) plutôt que celui d'un donjon (porte),
   * pour toute ligne sans `pictureUrl` résolue. Une ligne "Type" adossée à un `WakfuDungeonType`
   * (`type:...`, pas `type:other`) reste traitée comme un donjon malgré l'absence d'image unique
   * (plusieurs donjons fusionnés) : le pictogramme "porte" reste plus juste sémantiquement qu'une
   * silhouette de créature. */
  protected isFamilyRow(key: string): boolean {
    return key.startsWith('family:') || key === 'type:other';
  }

  /** Marque la vignette de `key` comme en échec (voir `RecapGroupRow.pictureUrl`/`failedThumbs`) —
   * `(error)` de l'`<img>`, jamais retentée ensuite. */
  protected onThumbError(key: string): void {
    this.failedThumbs.update((set) => new Set(set).add(key));
  }

  /** Mode "Donjon & Famille" (voir CLAUDE.md) : une ligne par donjon précis + une ligne par famille
   * de monstre représentative pour les combats hors donjon — deux tableaux déjà distincts côté
   * serveur (`PeriodStats.dungeons`/`families`, jamais le même id des deux côtés), simplement
   * concaténés puis triés par nombre de combats décroissant. */
  protected readonly groupRows = computed<RecapGroupRow[]>(() => {
    const period = this.historyStats.stats();
    if (!period) return [];
    const rows: RecapGroupRow[] = [
      ...period.dungeons.map((d) => ({
        key: `dungeon:${d.dungeonId}`,
        label: this.dungeonLabel(d.dungeonId),
        totals: d,
        pictureUrl: this.catalog.findWakfuDungeonEntryById(d.dungeonId)?.pictureUrl ?? null,
      })),
      ...period.families.map((f) => ({
        key: `family:${f.familyId ?? 'null'}`,
        label: this.familyLabel(f.familyId),
        totals: f,
        pictureUrl: null,
      })),
    ];
    return rows.sort((a, b) => b.totals.fights - a.totals.fights);
  });

  /** Mode "Type" (voir CLAUDE.md) : les 8 `WakfuDungeonType` fusionnés chacun en une seule ligne
   * (peu importe le donjon précis), + une ligne "Autres" fusionnant TOUTE `period.families` —
   * entièrement recalculé côté client à partir des mêmes données que `groupRows` (aucune requête
   * serveur supplémentaire, voir `mergeGroupTotals`). Un donjon dont l'id n'est pas (encore) résolu
   * par le catalogue est ignoré ici (cas limite, référentiel pas à jour) plutôt que de faire
   * échouer tout le regroupement. */
  protected readonly typeRows = computed<RecapGroupRow[]>(() => {
    const period = this.historyStats.stats();
    if (!period) return [];
    const buckets = new Map<WakfuDungeonType, PeriodGroupTotals[]>();
    for (const dungeon of period.dungeons) {
      const entry = this.catalog.findWakfuDungeonEntryById(dungeon.dungeonId);
      if (!entry) continue;
      const bucket = buckets.get(entry.type);
      if (bucket) bucket.push(dungeon);
      else buckets.set(entry.type, [dungeon]);
    }
    const rows: RecapGroupRow[] = DUNGEON_TYPES.filter((type) => buckets.has(type)).map((type) => ({
      key: `type:${type}`,
      label: this.dungeonTypeLabel(type),
      totals: mergeGroupTotals(buckets.get(type)!),
      // Bucket fusionné (plusieurs donjons possibles) : pas d'image unique pertinente, voir doc de
      // RecapGroupRow.pictureUrl.
      pictureUrl: null,
    }));
    if (period.families.length > 0) {
      rows.push({
        key: 'type:other',
        label: this.i18n.t('sessionRecap.period.otherFamily'),
        totals: mergeGroupTotals(period.families),
        pictureUrl: null,
      });
    }
    return rows.sort((a, b) => b.totals.fights - a.totals.fights);
  });

  /** Lignes réellement affichées par l'accordéon selon `detailMode` — vide (et donc jamais rendu)
   * en mode 'cumulative', où le template affiche les sections globales à la place (voir template). */
  protected readonly activeGroupRows = computed<RecapGroupRow[]>(() => {
    const mode = this.detailMode();
    if (mode === 'byGroup') return this.groupRows();
    if (mode === 'byType') return this.typeRows();
    return [];
  });

  /** Butin d'un groupe (ligne d'accordéon), converti/trié comme `sortedPeriodLoot` — partage les
   * mêmes signaux `lootSort`/`lootSortReverse` que les autres vues (aucun switch de tri dédié par
   * ligne d'accordéon, la liste pouvant compter de nombreuses lignes : le switch global de la vue
   * Cumulé, bien que non affiché en mode Donjon & Famille/Type, continue de piloter ces signaux). */
  protected sortedGroupLoot(totals: PeriodGroupTotals): LootRow[] {
    const rows: LootRow[] = totals.loot.map((row) => ({
      name: resolveItemName(row.itemId, row.itemName, this.catalog, this.i18n),
      catalogId: row.itemId,
      quantity: row.quantity,
    }));
    return sortLootRows(this.catalog, rows, this.lootSort(), this.lootSortReverse());
  }

  /** Sans paramètre (plutôt que `(g: PeriodGranularity)`) pour rester appelable telle quelle depuis
   * le template : `granularity()` y est du type large `Granularity`, que le template ne rétrécit
   * jamais automatiquement vers `PeriodGranularity` même sous un `@if` qui exclut `'session'` (à la
   * différence d'une variable locale TypeScript classique) — lire `this.granularity()` ICI, où un
   * simple `if` suffit à rétrécir normalement, évite ce frottement de typage côté template. */
  protected offsetMin(): number {
    const g = this.granularity();
    return g === 'session' ? 0 : OFFSET_MIN[g];
  }

  /** Déclenche l'agrégation serveur pour `granularity` au pas `offset` — période EN COURS (`0`,
   * jamais mise en cache : voir HistoryStatsService) ou PASSÉE (mise en cache par
   * `HistoryStatsService`, un passé déjà écoulé ne change plus). */
  private loadPeriod(g: PeriodGranularity, offset: number): void {
    const { start, end } = periodBounds(g, offset, Date.now());
    const cacheKey = offset === 0 ? undefined : `${g}:${offset}`;
    void this.historyStats.load(new Date(start), new Date(end), cacheKey);
  }

  /** Libellé affiché par le stepper (‹ label ›, voir StepperComponent) — texte déjà formaté/traduit
   * pour la période sélectionnée : termes relatifs pour les jours récents ("Aujourd'hui"/"Hier",
   * voir `formatRelativeDay`), "mois année" pour un mois, année seule pour une année. */
  protected periodLabel(): string {
    const g = this.granularity();
    if (g === 'session') return '';
    const { start } = periodBounds(g, this.periodOffset(), Date.now());
    if (g === 'day') return this.i18n.formatRelativeDay(start);
    if (g === 'month') return this.i18n.formatMonth(start);
    return this.i18n.formatYear(start);
  }

  /** Nom localisé d'un donjon du regroupement "Donjon & Famille" (voir `PeriodStats.dungeons`,
   * TOUJOURS un id non-null désormais — le hors-donjon part dans `families`, voir `familyLabel`).
   * Repli sur `sessionRecap.period.noDungeon` si l'id n'est pas (encore) résolu par le catalogue
   * (référentiel pas à jour pour un donjon récent, cas limite). */
  protected dungeonLabel(dungeonId: number): string {
    const entry = this.catalog.findWakfuDungeonEntryById(dungeonId);
    return entry?.[this.i18n.locale()] ?? this.i18n.t('sessionRecap.period.noDungeon');
  }

  /** Nom localisé d'une famille de monstre du regroupement "Donjon & Famille" (voir
   * `PeriodStats.families`) — mirroir de `dungeonLabel` : `null` = famille inconnue (monstre non
   * catalogué, voir `functions/api/v1/history/stats.ts`), résolu vers `sessionRecap.period.
   * noFamily`, même repli pour un id de famille pas encore résolu par le catalogue. */
  protected familyLabel(familyId: number | null): string {
    if (familyId === null) return this.i18n.t('sessionRecap.period.noFamily');
    const entry = this.catalog.findWakfuMonsterFamilyById(familyId);
    return entry?.[this.i18n.locale()] ?? this.i18n.t('sessionRecap.period.noFamily');
  }

  /** Libellé localisé d'un bucket du mode "Type" (voir `typeRows`) — un des 8 `WakfuDungeonType`. */
  protected dungeonTypeLabel(type: WakfuDungeonType): string {
    return this.i18n.t(DUNGEON_TYPE_KEY[type]);
  }

  /** Butin de la période agrégée (voir HistoryStatsService), converti au format `LootRow` attendu
   * par `sortLootRows`/`LootListComponent` — même résolution de nom que l'archive de compte
   * (`resolveItemName`, voir history-archive.service.ts) : `itemId`/`itemName` sont mutuellement
   * exclusifs côté serveur, un objet résolu n'a pas de nom transmis (résolu ici via le catalogue). */
  protected sortedPeriodLoot(): LootRow[] {
    const period = this.historyStats.stats();
    if (!period) return [];
    const rows: LootRow[] = period.loot.map((row) => ({
      name: resolveItemName(row.itemId, row.itemName, this.catalog, this.i18n),
      catalogId: row.itemId,
      quantity: row.quantity,
    }));
    return sortLootRows(this.catalog, rows, this.lootSort(), this.lootSortReverse());
  }

  /** Kamas gagnés sur la période (combat + ventes HDV + reçu en échange) — voir HistoryStatsService.
   * PeriodStats.kamas, ventilation détaillée absente de la vue Session (volontairement plus simple,
   * inchangée — voir CLAUDE.md). */
  protected periodKamasEarned(period: PeriodStats): number {
    return period.kamas.fromCombat + period.kamas.fromHdvSales + period.kamas.tradesAcquired;
  }

  /** Kamas perdus sur la période (achats + donné en échange). */
  protected periodKamasLost(period: PeriodStats): number {
    return period.kamas.spentOnPurchases + period.kamas.tradesGiven;
  }

  /** XP total de la session (case "Expérience" de la bande coup d'oeil, voir template) — simple
   * somme de `stats.xpByCharacter()`, qui ne porte que le détail par personnage. */
  protected sessionXpTotal(): number {
    return this.stats.xpByCharacter().reduce((sum, row) => sum + row.amount, 0);
  }

  /** Miroir de `sessionXpTotal` pour le bandeau de totaux du mode "Donjon & Famille"/"Type" (voir
   * template) — `period.xpByCharacter` n'est autrement affiché qu'en mode Cumulé. */
  protected periodXpTotal(period: PeriodStats): number {
    return period.xpByCharacter.reduce((sum, row) => sum + row.amount, 0);
  }

  /** Largeur (%) de la barre de progression d'une ligne XP (voir `.xp-bar-fill`, template),
   * relative au plus gros gain de SA PROPRE liste — jamais `rows[0]` : contrairement à
   * `stats.xpByCharacter()` (déjà triée décroissante côté client), `PeriodGroupTotals.
   * xpByCharacter` vient telle quelle de l'agrégation serveur, sans garantie d'ordre. */
  protected xpBarPercent(amount: number, rows: readonly { amount: number }[]): number {
    const max = rows.reduce((m, row) => Math.max(m, row.amount), 0);
    return max > 0 ? (amount / max) * 100 : 0;
  }

  /** Texte (2 lignes, voir `[tooltipMultiline]` sur la case Kamas du template) de la tooltip de la
   * bande coup d'oeil — remplace l'ancienne section Kamas dépliable du mode Session (voir
   * CLAUDE.md). Formatage direct via `numberFr` (pas le pipe de template ici, texte composite). */
  protected kamasTooltip(): string {
    const earned = this.numberFr.transform(this.stats.kamasEarned());
    const lost = this.numberFr.transform(this.stats.kamasLost());
    const earnedLabel = this.i18n.t('sessionRecap.earned');
    const spentLabel = this.i18n.t('sessionRecap.spent');
    return `${earnedLabel} +${earned} ₭\n${spentLabel} -${lost} ₭`;
  }

  protected onXpNameContextMenu(event: MouseEvent, name: string): void {
    event.preventDefault();
    this.classPickerService.open(name, event.clientX, event.clientY, (className, gender) => {
      this.classifier.setManualClass(name, className, gender);
    });
  }

  /**
   * Durée = temps ACTIF déjà accumulé depuis le fichier (voir StatsStoreService.
   * sessionActiveDurationMs — ne grandit que quand de vraies lignes ont été lues) + une extension
   * "temps réel" qui prolonge visuellement ce total entre deux lots de lignes tant qu'une partie
   * semble en cours (voir sessionLastIngestAtMs), plafonnée à SESSION_LIVE_TICK_GRACE_MS — au-delà
   * de ce plafond (10s), on considère que le fichier n'est plus alimenté et la durée cesse
   * d'augmenter automatiquement (comportement demandé explicitement — voir sa doc de tête pour
   * pourquoi ce délai de grâce reste bien plus court que le seuil de segmentation des coupures
   * historiques, SESSION_SEGMENT_GAP_THRESHOLD_MS, une question différente). Ne repart QUE lorsque
   * le fichier est de nouveau alimenté (prochain `ingest()`, qui avance sessionLastIngestAtMs et
   * potentiellement sessionActiveDurationMs) — jamais de lui-même.
   */
  private updateDuration(): void {
    const activeMs = this.stats.sessionActiveDurationMs();
    const lastIngestAtMs = this.stats.sessionLastIngestAtMs();
    const liveExtensionMs =
      lastIngestAtMs === null
        ? 0
        : Math.min(Math.max(Date.now() - lastIngestAtMs, 0), SESSION_LIVE_TICK_GRACE_MS);
    const elapsedMs = activeMs + liveExtensionMs;
    const hours = Math.floor(elapsedMs / 3_600_000);
    const minutes = Math.floor((elapsedMs % 3_600_000) / 60_000);
    const seconds = Math.floor((elapsedMs % 60_000) / 1000);
    const pad = (n: number) => n.toString().padStart(2, '0');
    this.duration.set(`${pad(hours)}:${pad(minutes)}:${pad(seconds)}`);
  }
}
