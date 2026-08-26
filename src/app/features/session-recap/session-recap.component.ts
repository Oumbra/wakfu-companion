import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
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
import { CatalogService } from '../../core/api/catalog.service';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { AuthService } from '../../core/auth/auth.service';
import { HistoryStatsService, PeriodStats } from '../../core/sync/history-stats.service';
import { resolveItemName } from '../../core/sync/history-archive.service';
import { localDayStart, localMonthStart, localYearStart } from '../../core/utils/local-period.util';

/** Granularité du switch Session/Jour/Mois/Année — voir `setGranularity`. `'session'` (défaut)
 * reste piloté par `StatsStoreService` (contenu du fichier connecté, inchangé) ; les trois autres
 * agrègent côté compte via `HistoryStatsService` (voir `functions/api/v1/history/stats.ts`), donc
 * uniquement pertinentes pour un utilisateur connecté (voir template, `auth.status()`). */
type Granularity = 'session' | 'day' | 'month' | 'year';
/** Marge ajoutée à "maintenant" pour la borne `until` envoyée au serveur — la période demandée est
 * toujours EN COURS (pas de navigation vers une période passée dans cette itération), `until` doit
 * donc rester strictement postérieur à `since` même dans le cas limite d'un changement de switch
 * survenant à la toute première milliseconde du jour/mois/année (voir parseStatsQuery côté
 * serveur, qui rejette `until <= since`) et couvrir tout ce qui a pu être ingéré dans la minute qui
 * vient de s'écouler. */
const PERIOD_UNTIL_BUFFER_MS = 60_000;

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

  protected readonly granularity = signal<Granularity>('session');

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

  /** Change de granularité et, hors 'session', déclenche l'agrégation serveur de la période EN
   * COURS (pas de navigation vers une période passée dans cette itération, voir CLAUDE.md). Pas de
   * cache : reproduit le rechargement à chaque changement de switch (décision explicite, voir
   * HistoryStatsService) — resélectionner une granularité déjà active recharge donc aussi, ce qui
   * reste cohérent (l'utilisateur peut vouloir rafraîchir un agrégat resté ouvert un moment). */
  protected setGranularity(next: Granularity): void {
    this.granularity.set(next);
    if (next === 'session') return;
    const now = Date.now();
    const since =
      next === 'day'
        ? localDayStart(now)
        : next === 'month'
          ? localMonthStart(now)
          : localYearStart(now);
    void this.historyStats.load(new Date(since), new Date(now + PERIOD_UNTIL_BUFFER_MS));
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
