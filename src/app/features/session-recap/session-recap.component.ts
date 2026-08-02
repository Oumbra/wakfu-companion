import { Component, ElementRef, inject, OnDestroy, signal, ViewChild } from '@angular/core';
import { LootRow, StatsStoreService } from '../../core/services/stats-store.service';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { EntityIconComponent } from '../../shared/entity-icon/entity-icon.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { EntityClassifierService } from '../../core/services/entity-classifier.service';
import { ClassPickerService } from '../../core/services/class-picker.service';
import {
  HEADER_ICON_CHALLENGES_DATA_URI,
  HEADER_ICON_COMBAT_DATA_URI,
  HEADER_ICON_KAMAS_DATA_URI,
  HEADER_ICON_LOOT_DATA_URI,
  HEADER_ICON_XP_DATA_URI,
} from '../../core/data/header-icons.data';
import { SESSION_RECAP_ICON_DATA_URI } from '../../core/data/session-recap-icon.data';
import { RARITY_ICON_BASE_DATA_URI } from '../../core/data/rarity-icon.data';
import { lootRarityClass, LootSort, sortLootRows } from '../../core/utils/loot-sort.util';

/**
 * Fenêtre flottante "Session Recap" : masquée par défaut, sans overlay de
 * fond, déplaçable par son en-tête (comme `makeDraggable` sur le site de
 * référence — pas besoin d'Angular CDK pour un simple glisser).
 */
@Component({
  selector: 'app-session-recap',
  imports: [NumberFrPipe, TranslatePipe, EntityIconComponent, ItemIconComponent],
  templateUrl: './session-recap.component.html',
  styleUrl: './session-recap.component.css',
})
export class SessionRecapComponent implements OnDestroy {
  protected readonly headerIcon = SESSION_RECAP_ICON_DATA_URI;
  protected readonly xpIcon = HEADER_ICON_XP_DATA_URI;
  protected readonly kamasIcon = HEADER_ICON_KAMAS_DATA_URI;
  protected readonly combatIcon = HEADER_ICON_COMBAT_DATA_URI;
  protected readonly challengesIcon = HEADER_ICON_CHALLENGES_DATA_URI;
  protected readonly lootIcon = HEADER_ICON_LOOT_DATA_URI;
  /** Toujours grise, que le tri par rareté soit actif ou non — voir FightHistoryComponent (même switch). */
  protected readonly rarityIcon = RARITY_ICON_BASE_DATA_URI;

  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);
  private readonly classifier = inject(EntityClassifierService);
  private readonly classPickerService = inject(ClassPickerService);

  @ViewChild('xpList') private readonly xpListRef?: ElementRef<HTMLDivElement>;

  protected readonly visible = signal(false);
  protected readonly duration = signal('00:00:00');
  protected readonly position = signal<{ left: number; top: number } | null>(null);
  protected readonly kamasExpanded = signal(false);
  protected readonly xpExpanded = signal(false);
  protected readonly combatsExpanded = signal(false);
  protected readonly lootSort = signal<LootSort>('name');

  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private dragStartMouse = { x: 0, y: 0 };
  private dragStartPos = { left: 0, top: 0 };
  private dragging = false;

  open(): void {
    this.visible.set(true);
    this.updateDuration();
    this.tickInterval ??= setInterval(() => this.updateDuration(), 1000);
  }

  close(): void {
    this.visible.set(false);
    // Sinon une position glissée en desktop (coordonnées pixel absolues)
    // reste appliquée telle quelle après un passage en mode mobile — le
    // panneau peut alors se retrouver hors écran/invisible à la réouverture.
    this.position.set(null);
    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  toggle(): void {
    if (this.visible()) this.close();
    else this.open();
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
    this.lootSort.set(mode);
  }

  protected sortedLoot(): LootRow[] {
    return sortLootRows(this.stats.sessionLoot(), this.lootSort());
  }

  protected rarityClass(name: string): string {
    return lootRarityClass(name);
  }

  protected isWatched(name: string): boolean {
    return this.stats.isWatched(name);
  }

  protected onLootContextMenu(event: MouseEvent, name: string): void {
    event.preventDefault();
    this.stats.addWatchedItem(name);
  }

  protected onXpNameContextMenu(event: MouseEvent, name: string): void {
    event.preventDefault();
    this.classPickerService.open(name, event.clientX, event.clientY, (className, gender) => {
      this.classifier.setManualClass(name, className, gender);
    });
  }

  ngOnDestroy(): void {
    if (this.tickInterval !== null) clearInterval(this.tickInterval);
  }

  protected onHeaderMouseDown(event: MouseEvent, panel: HTMLElement): void {
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    this.position.set({ left: rect.left, top: rect.top });
    this.dragStartPos = { left: rect.left, top: rect.top };
    this.dragStartMouse = { x: event.clientX, y: event.clientY };
    this.dragging = true;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!this.dragging) return;
      const deltaX = moveEvent.clientX - this.dragStartMouse.x;
      const deltaY = moveEvent.clientY - this.dragStartMouse.y;
      this.position.set({
        left: this.dragStartPos.left + deltaX,
        top: this.dragStartPos.top + deltaY,
      });
    };
    const onMouseUp = () => {
      this.dragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  private updateDuration(): void {
    const startedAt = this.stats.sessionStartedAt();
    if (startedAt === null) {
      this.duration.set('00:00:00');
      return;
    }
    const elapsedMs = Date.now() - startedAt;
    const hours = Math.floor(elapsedMs / 3_600_000);
    const minutes = Math.floor((elapsedMs % 3_600_000) / 60_000);
    const seconds = Math.floor((elapsedMs % 60_000) / 1000);
    const pad = (n: number) => n.toString().padStart(2, '0');
    this.duration.set(`${pad(hours)}:${pad(minutes)}:${pad(seconds)}`);
  }
}
