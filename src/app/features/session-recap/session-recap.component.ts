import { NgTemplateOutlet } from '@angular/common';
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
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { LootListComponent } from '../../shared/loot-list/loot-list.component';
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
import { dungeonStoneItemIdForType } from '../../core/utils/dungeon-run-grouping.util';
import { normalizeWakfuName } from '../../core/utils/wakfu-name.util';
import { UNKNOWN_ENTITY_ICON_DATA_URI } from '../../core/data/class-icons.data';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { AuthService } from '../../core/auth/auth.service';
import {
  HistoryStatsService,
  PeriodGroupTotals,
  PeriodStats,
} from '../../core/sync/history-stats.service';
import { resolveItemName } from '../../core/sync/history-archive.service';
import {
  PeriodGranularity,
  minOffsetForGranularity,
  periodBounds,
} from '../../core/utils/local-period.util';
import { mergeGroupTotals } from '../../core/utils/period-group-merge.util';
import { StepperComponent } from '../../shared/stepper/stepper.component';
import { PeriodPickerService } from '../../core/services/period-picker.service';
import { PersistenceService } from '../../core/services/persistence.service';
import { RecapPeriodBadgeService } from '../../core/services/recap-period-badge.service';
import { BREACH_IMAGE_URL, ULTIMATE_BREACH_IMAGE_URL } from '../../core/data/breach-icon.data';

/** Granularité du switch Session/Jour/Mois/Année — voir `setGranularity`. `'session'` (défaut)
 * reste piloté par `StatsStoreService` (contenu du fichier connecté, inchangé) ; les trois autres
 * agrègent côté compte via `HistoryStatsService` (voir `functions/api/v1/history/stats.ts`), donc
 * uniquement pertinentes pour un utilisateur connecté (voir template, `auth.isAuthenticated()`). */
type Granularity = 'session' | PeriodGranularity;

const VALID_GRANULARITIES: readonly Granularity[] = ['session', 'day', 'month', 'year'];
/** Clé `PersistenceService` du dernier choix de granularité (voir `Granularity`) — préférence
 * d'affichage locale (pas une des données synchronisées `UserDataService`), demande explicite de
 * l'utilisateur (2026-08-28) : conservé d'une période à l'autre ET d'un repli/dépli de la carte à
 * l'autre (le composant est démonté/remonté à chaque repli, voir sa doc de tête — sans persistance,
 * les signaux repartiraient de leurs valeurs par défaut à chaque réaffichage). */
const GRANULARITY_STORAGE_KEY = 'wakfu-recap-granularity';
/** Clé jumelle pour `DetailMode` (voir plus bas) — même raisonnement. */
const DETAIL_MODE_STORAGE_KEY = 'wakfu-recap-detail-mode';

/** Mode d'affichage du détail Jour/Mois/Année (voir `detailMode`) — `'cumulative'` (défaut)
 * reproduit exactement l'ancien affichage (XP/Kamas/Combats/Butin globaux de la période) ;
 * `'byGroup'`/`'byType'` le REMPLACENT par une liste accordéon (voir `activeGroupRows`) plutôt que
 * de s'y ajouter. Conservé d'un changement de granularité à l'autre (voir `GRANULARITY_STORAGE_KEY`
 * — demande explicite de l'utilisateur, 2026-08-28 : passer de Jour à Mois doit garder le même mode
 * de détail plutôt que de revenir à Cumulé à chaque fois). */
type DetailMode = 'cumulative' | 'byGroup' | 'byType';
const VALID_DETAIL_MODES: readonly DetailMode[] = ['cumulative', 'byGroup', 'byType'];

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

/** Illustration de repli pour les 2 `WakfuDungeonType` sans pierre (voir `dungeonStoneItemIdForType`)
 * — voir doc de `typeRows`, remplace le pictogramme générique "porte" par une image dédiée. Les
 * autres types (avec pierre, ou "Autres"/familles) n'y figurent pas volontairement. */
const BREACH_TYPE_IMAGE: Partial<Record<WakfuDungeonType, string>> = {
  BREACH: BREACH_IMAGE_URL,
  ULTIMATE_BREACH: ULTIMATE_BREACH_IMAGE_URL,
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
  /** Id Ankama de la pierre de donjon associée (voir `dungeonStoneItemIdForType`) — uniquement pour
   * une ligne du mode "Type" adossée à un `WakfuDungeonType` qui délivre une pierre (2/3/4 salles, 3
   * joueurs, boss ultime, voir CLAUDE.md) ; `null` pour toute ligne "Donjon & Famille" (le donjon
   * précis a déjà sa propre illustration, voir `pictureUrl`), une famille, ou un type sans pierre
   * (brèche, arcade). Affiché EN AVANT du libellé (voir template) plutôt qu'en vignette. */
  stoneItemId: number | null;
  /** `true` pour une ligne "Type" sans aucun combat sur la période (voir `typeRows`) — toujours
   * affichée (les 8 `WakfuDungeonType` sont exhaustifs, jamais filtrés à zéro) mais non cliquable
   * (pas de caret/détail à déplier, rien à montrer) et grisée côté template. `false` pour toute
   * ligne de `groupRows`/`groupSections`, jamais désactivée : un donjon/famille n'apparaît que s'il
   * a été rencontré au moins une fois sur la période. */
  disabled: boolean;
  /** Donjons précis composant cette ligne "Type" (voir `typeRows`) — toujours `[]` pour une ligne
   * "Donjon & Famille"/famille (le concept ne s'y applique pas, la ligne EST déjà un donjon
   * précis). Affiché en grille de tuiles dans le détail déplié (demande explicite de l'utilisateur,
   * 2026-08-28) : savoir, à l'intérieur d'un bucket "Type" fusionné, QUELS donjons précis
   * (et combien de fois chacun) composent le total affiché. */
  tiles: readonly DungeonTile[];
}

/** Une tuile = un donjon précis rencontré au moins une fois dans un bucket "Type" (voir `typeRows`/
 * `RecapGroupRow.tiles`) — `count` = nombre de fois FAIT (voir `rowCount`, même notion que le badge
 * "×N" de la ligne "Donjon & Famille" équivalente), pas un nombre de combats bruts. */
interface DungeonTile {
  dungeonId: number;
  label: string;
  pictureUrl: string | null;
  count: number;
}

/** Section non cliquable regroupant les lignes "Donjon & Famille" d'une même catégorie (voir
 * `groupSections`) — même ordre de catégories que `typeRows`/`DUNGEON_TYPES`, "Autres" (familles +
 * donjons dont le type n'est pas résolu par le catalogue) toujours en dernier. */
interface RecapGroupSection {
  key: string;
  label: string;
  rows: RecapGroupRow[];
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
    NgTemplateOutlet,
    NumberFrPipe,
    TranslatePipe,
    EntityIconComponent,
    ItemIconComponent,
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
  /** Repli du bucket "Autres" du mode "Type" (voir `typeRows`) — image générique de créature/entité
   * non reconnue, déjà utilisée ailleurs dans l'app (voir `getClassIconUri`) plutôt qu'un pictogramme
   * SVG dédié : "Autres" fusionne précisément les combats hors donjon dont le monstre représentatif
   * n'a pas pu être classé plus précisément. */
  protected readonly unknownEntityIcon = UNKNOWN_ENTITY_ICON_DATA_URI;

  protected readonly stats = inject(StatsStoreService);
  private readonly catalog = inject(CatalogService);
  protected readonly i18n = inject(I18nService);
  protected readonly layout = inject(DashboardLayoutService);
  protected readonly auth = inject(AuthService);
  protected readonly historyStats = inject(HistoryStatsService);
  private readonly periodPickerService = inject(PeriodPickerService);
  private readonly persistence = inject(PersistenceService);
  protected readonly periodBadge = inject(RecapPeriodBadgeService);

  /** Restauré depuis `PersistenceService` (voir `GRANULARITY_STORAGE_KEY`) — repli sur `'session'`
   * si rien de persisté ou valeur corrompue. */
  protected readonly granularity = signal<Granularity>(
    (() => {
      const stored = this.persistence.getJson<Granularity>(GRANULARITY_STORAGE_KEY);
      return stored && VALID_GRANULARITIES.includes(stored) ? stored : 'session';
    })(),
  );
  /** Pas courant dans le stepper de navigation par période — `0` = période EN COURS (jour/mois/
   * année contenant maintenant), négatif = passé (voir `periodBounds`). Toujours réinitialisé à
   * `0` par `setGranularity` : changer de granularité repart de la période courante. Volontairement
   * PAS persisté (contrairement à `granularity`/`detailMode`) : rouvrir la carte sur une période
   * passée arbitraire serait plus surprenant qu'utile. */
  protected readonly periodOffset = signal(0);

  /** Mode d'affichage du détail (voir `DetailMode`) — restauré depuis `PersistenceService` (voir
   * `DETAIL_MODE_STORAGE_KEY`), conservé d'un changement de granularité à l'autre depuis le
   * 2026-08-28 (demande explicite de l'utilisateur — auparavant réinitialisé à `'cumulative'` à
   * chaque changement). */
  protected readonly detailMode = signal<DetailMode>(
    (() => {
      const stored = this.persistence.getJson<DetailMode>(DETAIL_MODE_STORAGE_KEY);
      return stored && VALID_DETAIL_MODES.includes(stored) ? stored : 'cumulative';
    })(),
  );
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
  /** Repli/dépli de la liste XP > 3 lignes en mode Session uniquement (voir template) — les autres
   * vues (période, détail par groupe) affichent toujours la liste complète, aucun repli. */
  protected readonly xpExpanded = signal(true);
  protected readonly lootSort = signal<LootSort>('name');
  /** Sens du tri courant (`false` = sens par défaut de `lootSort`) — inversé au reclic sur le
   * switch déjà actif, voir `nextLootSortState`. */
  protected readonly lootSortReverse = signal(false);
  /** Recherche texte du butin (partagée entre les 3 vues — session/période cumulée/détail de
   * groupe — même convention que `lootSort`/`lootSortReverse`, déjà partagés à l'identique). Filtre
   * insensible à la casse ET aux accents via `normalizeWakfuName` (voir `filterLootRows`), appliqué
   * AVANT le tri choisi. */
  protected readonly lootSearch = signal('');

  private tickInterval: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.updateDuration();
    this.tickInterval = setInterval(() => this.updateDuration(), 1000);
    // Granularité restaurée non-'session' (voir GRANULARITY_STORAGE_KEY) : redéclenche le
    // chargement de la période, jamais fait automatiquement ailleurs (setGranularity/
    // onOffsetChange sont les deux seuls autres points d'entrée, tous deux déclenchés par une
    // interaction utilisateur qu'un simple réaffichage de la carte n'est pas).
    const g = this.granularity();
    if (g !== 'session') this.loadPeriod(g, this.periodOffset());
  }

  ngOnDestroy(): void {
    if (this.tickInterval !== null) clearInterval(this.tickInterval);
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

  protected setLootSort(mode: LootSort): void {
    const next = nextLootSortState(this.lootSort(), this.lootSortReverse(), mode);
    this.lootSort.set(next.sort);
    this.lootSortReverse.set(next.reverse);
  }

  protected sortedLoot(): LootRow[] {
    return sortLootRows(
      this.catalog,
      this.filterLootRows(this.stats.sessionLoot()),
      this.lootSort(),
      this.lootSortReverse(),
    );
  }

  protected lootSortTooltip(mode: LootSort): string {
    return computeLootSortTooltip(this.i18n, this.lootSort(), this.lootSortReverse(), mode);
  }

  /** Filtre le butin sur `lootSearch` (voir sa doc) — appliqué AVANT le tri par les 3 appelants
   * (`sortedLoot`/`sortedPeriodLoot`/`sortedRowLoot`), jamais après : un tri par rareté sur un
   * sous-ensemble filtré n'a pas besoin de connaître les objets exclus. Requête vide = aucun
   * filtrage (retourne `rows` tel quel, pas de coût de normalisation par ligne). */
  private filterLootRows(rows: readonly LootRow[]): LootRow[] {
    const query = this.lootSearch().trim();
    if (!query) return [...rows];
    const normalizedQuery = normalizeWakfuName(query);
    return rows.filter((row) => normalizeWakfuName(row.name).includes(normalizedQuery));
  }

  /** Change de granularité : repart toujours de la période EN COURS (`periodOffset` à `0`), même
   * si l'utilisateur avait navigué dans le passé sur la granularité précédente — changer de
   * granularité et naviguer sont deux gestes distincts, mélanger les deux surprendrait plus qu'autre
   * chose (« je clique sur Mois, je m'attends au mois EN COURS, pas à un mois arbitraire hérité du
   * dernier `periodOffset` laissé sur Jour »). `detailMode`, lui, N'EST PLUS réinitialisé (voir sa
   * doc — demande explicite de l'utilisateur, 2026-08-28) : passer de Jour à Mois garde le même
   * mode de détail. Persiste le choix (voir GRANULARITY_STORAGE_KEY) et marque la fonctionnalité
   * comme découverte (voir RecapPeriodBadgeService) dès qu'une granularité non-session est choisie.
   *
   * Referme tout l'accordéon (voir `expandedGroups`) : bug réel corrigé le 2026-08-28 — une ligne
   * dépliée (ex. "Donjon 3 joueurs") dans une granularité pouvait rester dépliée après un
   * changement de granularité alors que cette même clé, dans la NOUVELLE période, n'a plus aucun
   * combat (donjon désactivé à zéro, voir `RecapGroupRow.disabled`) : affichait un détail vide sans
   * qu'il soit possible de le refermer proprement (la ligne désactivée ignore les clics, voir le
   * template). Repartir de zéro à chaque changement de période/mode est plus simple ET plus sûr que
   * d'essayer de ne fermer que les clés devenues invalides (le même problème existe pour N'IMPORTE
   * QUELLE clé, pas seulement les lignes désactivées d'un type — voir `onOffsetChange`/
   * `setDetailMode` ci-dessous, même correctif). */
  protected setGranularity(next: Granularity): void {
    this.granularity.set(next);
    this.persistence.setJson(GRANULARITY_STORAGE_KEY, next);
    this.periodOffset.set(0);
    this.expandedGroups.set(new Set());
    if (next === 'session') return;
    this.periodBadge.markSeen();
    this.loadPeriod(next, 0);
  }

  /** Callback du stepper de navigation (‹ précédent / suivant ›, voir template) ET du mini
   * calendrier (`PeriodPickerService`/`openPeriodPicker`) — émis déjà borné à [offsetMin(), 0] par
   * l'un comme par l'autre. Referme tout l'accordéon (voir doc de `setGranularity`) : les donjons/
   * familles rencontrés changent d'une période à l'autre, une ligne dépliée d'ici n'a aucune raison
   * de rester pertinente là-bas. */
  protected onOffsetChange(next: number): void {
    this.periodOffset.set(next);
    this.expandedGroups.set(new Set());
    const g = this.granularity();
    if (g === 'session') return; // stepper masqué en session, ne devrait jamais être atteint
    this.loadPeriod(g, next);
  }

  /** Ouvre le mini calendrier de navigation (icône 📅, voir template) ancré sur le bouton cliqué —
   * même principe que `PeriodPickerService`/`ClassPickerService` ailleurs dans l'app (rendu au
   * niveau racine, voir CLAUDE.md "position: fixed niché dans un ancêtre transform"). */
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
   * `periodOffset` : rester sur la même période en changeant seulement comment elle est ventilée.
   * Persiste le choix (voir DETAIL_MODE_STORAGE_KEY). Referme tout l'accordéon (voir doc de
   * `setGranularity`) : les clés elles-mêmes changent de forme entre Donjon & Famille (`dungeon:`/
   * `family:`) et Type (`type:`), une clé dépliée de l'un n'existe simplement pas dans l'autre. */
  protected setDetailMode(mode: DetailMode): void {
    this.detailMode.set(mode);
    this.persistence.setJson(DETAIL_MODE_STORAGE_KEY, mode);
    this.expandedGroups.set(new Set());
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

  /** Clé `failedThumbs` d'une tuile de donjon (voir `DungeonTile`/typeRows) — même espace de clés
   * que la vignette de la ligne "Donjon & Famille" équivalente (`dungeon:${id}`, voir `groupRows`) :
   * un même donjon échoue au chargement de la même image, peu importe où elle est utilisée. */
  protected tileThumbKey(dungeonId: number): string {
    return `dungeon:${dungeonId}`;
  }

  /** Nombre affiché en tête de ligne (badge "×N", voir template) — le nombre de DONJONS (voir
   * `PeriodGroupTotals.dungeonRuns`), jamais le nombre de combats bruts : un donjon est un
   * regroupement de plusieurs combats (salles + tentatives de boss). Pour une ligne "famille"
   * (`dungeonRuns` toujours à 0, le concept ne s'y applique pas), retombe sur `fights` — chaque
   * combat hors donjon est sa propre rencontre, pas de regroupement à défaire. */
  protected rowCount(totals: PeriodGroupTotals): number {
    return totals.dungeonRuns > 0 ? totals.dungeonRuns : totals.fights;
  }

  /** Mode "Donjon & Famille" (voir CLAUDE.md) : une ligne par donjon précis + une ligne par famille
   * de monstre représentative pour les combats hors donjon — deux tableaux déjà distincts côté
   * serveur (`PeriodStats.dungeons`/`families`, jamais le même id des deux côtés), simplement
   * concaténés puis triés par nombre de DONJONS décroissant (voir `rowCount`, pas le nombre de
   * combats bruts). */
  protected readonly groupRows = computed<RecapGroupRow[]>(() => {
    const period = this.historyStats.stats();
    if (!period) return [];
    const rows: RecapGroupRow[] = [
      ...period.dungeons.map((d) => ({
        key: `dungeon:${d.dungeonId}`,
        label: this.dungeonLabel(d.dungeonId),
        totals: d,
        pictureUrl: this.catalog.findWakfuDungeonEntryById(d.dungeonId)?.pictureUrl ?? null,
        stoneItemId: null,
        disabled: false,
        tiles: [],
      })),
      ...period.families.map((f) => ({
        key: `family:${f.familyId ?? 'null'}`,
        label: this.familyLabel(f.familyId),
        totals: f,
        pictureUrl: null,
        stoneItemId: null,
        disabled: false,
        tiles: [],
      })),
    ];
    return rows.sort((a, b) => this.rowCount(b.totals) - this.rowCount(a.totals));
  });

  /** Mode "Donjon & Famille" TRIÉ PAR CATÉGORIE (demande explicite de l'utilisateur, 2026-08-28) :
   * même bucketing que `typeRows` (résolution du `WakfuDungeonType` de chaque donjon via le
   * catalogue), mais SANS fusionner les stats — chaque donjon garde sa propre ligne/détail,
   * seulement regroupé sous un titre de section par catégorie. Un donjon dont le type n'est pas
   * (encore) résolu par le catalogue part dans la section "Autres" plutôt que d'être perdu (à la
   * différence de `typeRows`, qui l'ignore silencieusement — ici la donnée doit rester visible
   * quelque part, juste pas classée avec certitude). Tri interne à chaque section : inchangé
   * (nombre de donjons décroissant, voir `rowCount`). */
  protected readonly groupSections = computed<RecapGroupSection[]>(() => {
    const rows = this.groupRows();
    const byType = new Map<WakfuDungeonType, RecapGroupRow[]>();
    const other: RecapGroupRow[] = [];
    for (const row of rows) {
      const dungeonId = this.dungeonIdFromRowKey(row.key);
      const type =
        dungeonId !== null ? this.catalog.findWakfuDungeonEntryById(dungeonId)?.type : undefined;
      if (type) {
        const bucket = byType.get(type);
        if (bucket) bucket.push(row);
        else byType.set(type, [row]);
      } else {
        other.push(row);
      }
    }
    const sections: RecapGroupSection[] = DUNGEON_TYPES.filter((type) => byType.has(type)).map(
      (type) => ({
        key: `section:${type}`,
        label: this.dungeonTypeLabel(type),
        rows: byType.get(type)!,
      }),
    );
    if (other.length > 0) {
      sections.push({
        key: 'section:other',
        // "Familles" (pas "Autres" comme `typeRows`, voir sessionRecap.period.familiesSection) :
        // demande explicite de l'utilisateur, 2026-08-28 — ce mode liste les donjons PRÉCIS un par
        // un, donc "Autres" par rapport à ces catégories PRÉCISES ne veut rien dire ; ce bucket ne
        // contient QUE des familles hors donjon, "Familles" est donc littéralement exact ici (à la
        // différence de `typeRows`, où "Autres" fusionne tout ce qui n'est pas l'une des 8
        // catégories de donjon — un terme générique reste juste dans CE contexte-là).
        label: this.i18n.t('sessionRecap.period.familiesSection'),
        rows: other,
      });
    }
    return sections;
  });

  /** Extrait l'id de donjon d'une clé `RecapGroupRow.key` (`dungeon:${id}`) — `null` pour une clé
   * `family:...` (aucun donjon associé). Sert uniquement à `groupSections` pour retrouver le
   * `WakfuDungeonType` de chaque ligne via le catalogue sans porter cette info dans `RecapGroupRow`
   * lui-même (qui reste commun à `groupRows`/`typeRows`, où elle n'aurait pas de sens). */
  private dungeonIdFromRowKey(key: string): number | null {
    if (!key.startsWith('dungeon:')) return null;
    const id = Number(key.slice('dungeon:'.length));
    return Number.isNaN(id) ? null : id;
  }

  /** Mode "Type" (voir CLAUDE.md) : les 8 `WakfuDungeonType` fusionnés chacun en une seule ligne
   * (peu importe le donjon précis), + une ligne "Autres" fusionnant TOUTE `period.families` —
   * entièrement recalculé côté client à partir des mêmes données que `groupRows` (aucune requête
   * serveur supplémentaire, voir `mergeGroupTotals`). Un donjon dont l'id n'est pas (encore) résolu
   * par le catalogue est ignoré ici (cas limite, référentiel pas à jour) plutôt que de faire
   * échouer tout le regroupement.
   *
   * Ordre volontairement PAS trié par nombre de donjons (contrairement à `groupRows`) : ordre FIXE
   * demandé explicitement (2 salles, 3 salles, 4 salles, 3 joueurs, boss ultime, puis brèche/brèche
   * ultime/arcade — l'ordre naturel de `DUNGEON_TYPES`), "Autres" toujours en dernier.
   *
   * TOUJOURS les 7 catégories "réelles" de donjon (2/3/4 salles, 3 joueurs, boss ultime, brèche,
   * brèche ultime — demande explicite du 2026-08-28, ancien comportement : une catégorie sans aucun
   * donjon rencontré sur la période disparaissait entièrement) — une catégorie vide obtient une
   * ligne `disabled: true` à zéro plutôt que d'être omise, pour représenter l'ensemble des
   * possibilités même quand la période n'en couvre qu'une partie. `ARCADE` fait exception (demande
   * explicite du 2026-08-28) : aucun vrai donjon arcade n'existe en pratique dans le jeu à ce jour,
   * une ligne désactivée à zéro n'aurait donc aucune valeur — omise comme "Autres" (familles) tant
   * qu'aucune donnée n'y correspond, mais PAS supprimée du système (`DUNGEON_TYPES`/
   * `DUNGEON_TYPE_KEY` la couvrent toujours : un futur vrai donjon arcade rencontré ferait
   * réapparaître sa ligne normalement, comme n'importe quel autre type). */
  protected readonly typeRows = computed<RecapGroupRow[]>(() => {
    const period = this.historyStats.stats();
    if (!period) return [];
    const buckets = new Map<WakfuDungeonType, (PeriodGroupTotals & { dungeonId: number })[]>();
    for (const dungeon of period.dungeons) {
      const entry = this.catalog.findWakfuDungeonEntryById(dungeon.dungeonId);
      if (!entry) continue;
      const bucket = buckets.get(entry.type);
      if (bucket) bucket.push(dungeon);
      else buckets.set(entry.type, [dungeon]);
    }
    const visibleTypes = DUNGEON_TYPES.filter((type) => type !== 'ARCADE' || buckets.has(type));
    const rows: RecapGroupRow[] = visibleTypes.map((type) => {
      const bucket = buckets.get(type);
      return {
        key: `type:${type}`,
        label: this.dungeonTypeLabel(type),
        totals: mergeGroupTotals(bucket ?? []),
        // Bucket fusionné (plusieurs donjons possibles) : pas d'image unique pertinente EN GÉNÉRAL,
        // voir doc de RecapGroupRow.pictureUrl — la pierre du type (voir stoneItemId) sert de repère
        // visuel à la place. Exception : BREACH/ULTIMATE_BREACH ne délivrent aucune pierre
        // (`dungeonStoneItemIdForType` renvoie `null` pour ces deux types), et retombaient donc sur
        // le pictogramme générique "porte" — remplacé par les illustrations dédiées déjà utilisées
        // pour ces mêmes catégories ailleurs dans l'app (voir breach-icon.data.ts,
        // resolveFightImageInfo), demande explicite de l'utilisateur (2026-08-28).
        pictureUrl: BREACH_TYPE_IMAGE[type] ?? null,
        stoneItemId: dungeonStoneItemIdForType(type),
        disabled: !bucket,
        tiles: (bucket ?? [])
          .map((dungeon) => ({
            dungeonId: dungeon.dungeonId,
            label: this.dungeonLabel(dungeon.dungeonId),
            pictureUrl:
              this.catalog.findWakfuDungeonEntryById(dungeon.dungeonId)?.pictureUrl ?? null,
            count: this.rowCount(dungeon),
          }))
          .sort((a, b) => b.count - a.count),
      };
    });
    if (period.families.length > 0) {
      rows.push({
        key: 'type:other',
        label: this.i18n.t('sessionRecap.period.otherFamily'),
        totals: mergeGroupTotals(period.families),
        pictureUrl: null,
        stoneItemId: null,
        disabled: false,
        tiles: [],
      });
    }
    return rows;
  });

  /** Lignes réellement affichées par l'accordéon selon `detailMode` — vide (et donc jamais rendu)
   * en mode 'cumulative', où le template affiche les sections globales à la place (voir template). */
  protected readonly activeGroupRows = computed<RecapGroupRow[]>(() => {
    const mode = this.detailMode();
    if (mode === 'byGroup') return this.groupRows();
    if (mode === 'byType') return this.typeRows();
    return [];
  });

  /** Butin d'une ligne d'accordéon (donjon, famille, ou bucket "Type"), converti/trié comme
   * `sortedPeriodLoot` — mêmes signaux `lootSort`/`lootSortReverse` que partout ailleurs dans la
   * carte (voir CLAUDE.md, tri du butin réutilisé identiquement à chaque endroit où du butin
   * s'affiche), pas de switch dédié par ligne.
   *
   * Pour une ligne "Type" adossée à une pierre de donjon (`row.stoneItemId`, voir CLAUDE.md) : la
   * pierre reste TOUJOURS la toute première ligne, même à quantité 0 (synthétisée si absente du
   * butin réel de la période) — épinglée en tête, hors du tri choisi par l'utilisateur, qui ne
   * s'applique qu'au RESTE du butin. */
  protected sortedRowLoot(row: RecapGroupRow): LootRow[] {
    const rows: LootRow[] = row.totals.loot.map((item) => ({
      name: resolveItemName(item.itemId, item.itemName, this.catalog, this.i18n),
      catalogId: item.itemId,
      quantity: item.quantity,
    }));
    if (row.stoneItemId === null) {
      return sortLootRows(
        this.catalog,
        this.filterLootRows(rows),
        this.lootSort(),
        this.lootSortReverse(),
      );
    }
    const stoneId = row.stoneItemId;
    const existing = rows.find((r) => r.catalogId === stoneId);
    const stoneRow: LootRow = existing ?? {
      name: resolveItemName(stoneId, null, this.catalog, this.i18n),
      catalogId: stoneId,
      quantity: 0,
    };
    // La pierre reste épinglée en tête MÊME si elle ne correspond pas à la recherche en cours —
    // repère visuel fixe du bucket "Type" (voir doc de RecapGroupRow.stoneItemId), pas un objet de
    // butin comme les autres à filtrer.
    const rest = rows.filter((r) => r.catalogId !== stoneId);
    return [
      stoneRow,
      ...sortLootRows(
        this.catalog,
        this.filterLootRows(rest),
        this.lootSort(),
        this.lootSortReverse(),
      ),
    ];
  }

  /** Sans paramètre (plutôt que `(g: PeriodGranularity)`) pour rester appelable telle quelle depuis
   * le template : `granularity()` y est du type large `Granularity`, que le template ne rétrécit
   * jamais automatiquement vers `PeriodGranularity` même sous un `@if` qui exclut `'session'` (à la
   * différence d'une variable locale TypeScript classique) — lire `this.granularity()` ICI, où un
   * simple `if` suffit à rétrécir normalement, évite ce frottement de typage côté template. */
  protected offsetMin(): number {
    const g = this.granularity();
    return g === 'session' ? 0 : minOffsetForGranularity(g, Date.now());
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
    return sortLootRows(
      this.catalog,
      this.filterLootRows(rows),
      this.lootSort(),
      this.lootSortReverse(),
    );
  }

  /** Kamas gagnés sur la période (combat + ventes HDV + reçu en échange) — voir HistoryStatsService.
   * PeriodStats.kamas. */
  protected periodKamasEarned(period: PeriodStats): number {
    return period.kamas.fromCombat + period.kamas.fromHdvSales + period.kamas.tradesAcquired;
  }

  /** Kamas perdus sur la période (achats + donné en échange). */
  protected periodKamasLost(period: PeriodStats): number {
    return period.kamas.spentOnPurchases + period.kamas.tradesGiven;
  }

  /** Construit le texte aligné (libellé à gauche, valeur à droite) d'une tooltip Kamas — partagé
   * entre `kamasTooltip` (Session) et `periodKamasTooltip` (Jour/Mois/Année), demande explicite de
   * l'utilisateur (2026-08-28) : les deux affichaient auparavant deux mises en page DIFFÉRENTES
   * (2 lignes non alignées pour la Session vs 4 lignes alignées pour la période), désormais la MÊME
   * ventilation par origine à 5 lignes (combat/Hôtel de vente/achats/échanges REÇUS/échanges DONNÉS
   * — les échanges scindés en deux lignes plutôt qu'un seul solde net, un échange pouvant être à la
   * fois un gain ET une perte).
   *
   * Colonnes alignées : `.app-tooltip-multiline` (`white-space: pre-line`) collapse les espaces
   * normaux mais PAS les espaces insécables (` `), d'où leur usage ici pour le padding plutôt
   * que de simples espaces — combiné à `[tooltipMonospace]` (voir template) pour que le padding en
   * nombre de caractères corresponde bien à un espacement visuel constant. */
  private buildKamasTooltip(kamas: {
    fromCombat: number;
    fromHdvSales: number;
    spentOnPurchases: number;
    tradesAcquired: number;
    tradesGiven: number;
  }): string {
    const fmt = (n: number) => this.i18n.formatNumber(n);
    const lines: [string, string][] = [
      [this.i18n.t('sessionRecap.period.kamasFromCombat'), `+${fmt(kamas.fromCombat)} ₭`],
      [this.i18n.t('sessionRecap.period.kamasFromHdvSales'), `+${fmt(kamas.fromHdvSales)} ₭`],
      [
        this.i18n.t('sessionRecap.period.kamasSpentOnPurchases'),
        `-${fmt(kamas.spentOnPurchases)} ₭`,
      ],
      [this.i18n.t('sessionRecap.period.kamasTradesAcquired'), `+${fmt(kamas.tradesAcquired)} ₭`],
      [this.i18n.t('sessionRecap.period.kamasTradesGiven'), `-${fmt(kamas.tradesGiven)} ₭`],
    ];
    const labelWidth = Math.max(...lines.map(([label]) => label.length));
    const valueWidth = Math.max(...lines.map(([, value]) => value.length));
    return lines
      .map(
        ([label, value]) => `${label.padEnd(labelWidth, ' ')} ${value.padStart(valueWidth, ' ')}`,
      )
      .join('\n');
  }

  /** Tooltip Kamas du bandeau en mode période (voir `buildKamasTooltip`) — remplace l'ancienne
   * section "Kamas" dépliable (voir CLAUDE.md). */
  protected periodKamasTooltip(period: PeriodStats): string {
    return this.buildKamasTooltip(period.kamas);
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

  /** Total XP d'UNE ligne de regroupement (donjon, famille, ou bucket Type) — affiché dans le
   * bandeau Expérience/Kamas/Victoires/Défaites du détail déplié (voir template), pas sur la ligne
   * repliée. Générique (prend `PeriodGroupTotals` plutôt que `PeriodStats`), contrairement à
   * `periodXpTotal`/`sessionXpTotal` qui opèrent chacun sur une forme différente. */
  protected rowXpTotal(totals: PeriodGroupTotals): number {
    return totals.xpByCharacter.reduce((sum, row) => sum + row.amount, 0);
  }

  /** Largeur (%) de la barre de progression d'une ligne XP (voir `.xp-bar-fill`, template),
   * relative au plus gros gain de SA PROPRE liste — jamais `rows[0]` : contrairement à
   * `stats.xpByCharacter()` (déjà triée décroissante côté client), `PeriodGroupTotals.
   * xpByCharacter` vient telle quelle de l'agrégation serveur, sans garantie d'ordre. */
  protected xpBarPercent(amount: number, rows: readonly { amount: number }[]): number {
    const max = rows.reduce((m, row) => Math.max(m, row.amount), 0);
    return max > 0 ? (amount / max) * 100 : 0;
  }

  /** Tooltip Kamas de la bande "coup d'oeil" en mode Session (voir `buildKamasTooltip`) — même
   * ventilation à 5 lignes que le mode période (voir `StatsStoreService.kamasFromCombat` et les 4
   * signaux jumeaux, ajoutés le 2026-08-28 spécifiquement pour égaler cette ventilation, alors
   * qu'avant seul un total Gagné/Dépensé non ventilé était disponible côté session). */
  protected kamasTooltip(): string {
    return this.buildKamasTooltip({
      fromCombat: this.stats.kamasFromCombat(),
      fromHdvSales: this.stats.kamasFromHdvSales(),
      spentOnPurchases: this.stats.kamasSpentOnPurchases(),
      tradesAcquired: this.stats.kamasTradesAcquired(),
      tradesGiven: this.stats.kamasTradesGiven(),
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
