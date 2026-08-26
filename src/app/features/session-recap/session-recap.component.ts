import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import {
  LootRow,
  SESSION_GAP_THRESHOLD_MS,
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
   * semble en cours (voir sessionLastIngestAtMs), plafonnée à SESSION_GAP_THRESHOLD_MS — au-delà de
   * ce plafond, on considère que le fichier n'est plus alimenté et la durée cesse d'augmenter
   * automatiquement (comportement demandé explicitement : contrairement à l'ancien calcul, purement
   * `Date.now() - dateDeConnexion`, qui grandissait indéfiniment même client fermé/PC en veille).
   */
  private updateDuration(): void {
    const activeMs = this.stats.sessionActiveDurationMs();
    const lastIngestAtMs = this.stats.sessionLastIngestAtMs();
    const liveExtensionMs =
      lastIngestAtMs === null
        ? 0
        : Math.min(Math.max(Date.now() - lastIngestAtMs, 0), SESSION_GAP_THRESHOLD_MS);
    const elapsedMs = activeMs + liveExtensionMs;
    const hours = Math.floor(elapsedMs / 3_600_000);
    const minutes = Math.floor((elapsedMs % 3_600_000) / 60_000);
    const seconds = Math.floor((elapsedMs % 60_000) / 1000);
    const pad = (n: number) => n.toString().padStart(2, '0');
    this.duration.set(`${pad(hours)}:${pad(minutes)}:${pad(seconds)}`);
  }
}
