import { Component, computed, ElementRef, inject, signal } from '@angular/core';
import { StatsStoreService, WatchlistEntry } from '../../core/services/stats-store.service';
import { EntityIconComponent } from '../../shared/entity-icon/entity-icon.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { WakfuAutocompleteComponent } from '../../shared/wakfu-autocomplete/wakfu-autocomplete.component';
import { WakfuSearchResult } from '../../core/services/wakfu-search.service';
import { getWakfuItemRarity } from '../../core/data/wakfu-item-rarity.data';

/**
 * Suivi (desktop) : bande horizontale de KPI compacts au-dessus de la ligne
 * de panneaux (voir dashboard.component.html), sans fond ni bordure propres
 * — chaque tuile se déploie au survol pour révéler nom + reset. Masqué en
 * dessous du breakpoint mobile (voir CSS) : le mobile garde Suivi comme un
 * onglet à part entière, affiché par TrackerComponent (grille de cartes).
 */
@Component({
  selector: 'app-tracker-strip',
  imports: [NumberFrPipe, EntityIconComponent, ItemIconComponent, TranslatePipe, WakfuAutocompleteComponent],
  templateUrl: './tracker-strip.component.html',
  styleUrl: './tracker-strip.component.css',
})
export class TrackerStripComponent {
  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  protected readonly existingNames = computed(() =>
    this.stats.watchlist().map((w) => ({ name: w.name, kind: w.kind })),
  );

  protected readonly addOpen = signal(false);
  /** Nom de l'entrée dont la popover de confirmation de suppression est actuellement ouverte (une seule à la fois). */
  protected readonly confirmDeleteName = signal<string | null>(null);
  /** Position (right/bottom, relative au host) de la popover ouverte — voir `hostRelativePos`. */
  protected readonly confirmPopoverPos = signal<{ right: number; bottom: number } | null>(null);
  /** Tooltip du nom tronqué actuellement survolé (texte + position relative au host) — voir
   * `hostRelativePos` : ne peut pas être un simple `[title]`/`[data-tooltip]` CSS ici, la classe
   * globale `[title]::after` (styles.css) serait de toute façon rognée par `.kpi-strip`
   * (`overflow-y:hidden`, scroll horizontal seul), donc positionnée en JS comme la popover de
   * suppression plutôt que de dupliquer le système CSS générique dans ce contexte particulier. */
  protected readonly nameTooltip = signal<{ text: string; right: number; bottom: number } | null>(
    null,
  );

  protected rarityClass(entry: WatchlistEntry): string {
    return entry.kind === 'item' ? `rarity-${getWakfuItemRarity(entry.name)}` : '';
  }

  protected displayName(entry: WatchlistEntry): string {
    return entry.kind === 'item'
      ? this.i18n.translateItemName(entry.name)
      : this.i18n.translateMonsterName(entry.name);
  }

  /** Position (right/bottom en px) d'un élément relativement au host — sert à sortir les
   * popovers/tooltips de `.kpi-strip` (qui les rognerait via son overflow) sans pour autant les
   * ancrer en `position:fixed` (le host vit sous `.view-slider`, qui porte un `transform` :
   * `position:fixed` s'y positionnerait relativement à cet ancêtre, pas au viewport — voir
   * CLAUDE.md). `:host{position:relative}`, sans overflow, sert donc de containing block. */
  private hostRelativePos(target: HTMLElement, gap: number): { right: number; bottom: number } {
    const hostRect = this.elementRef.nativeElement.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    return {
      right: hostRect.right - targetRect.right - gap,
      bottom: hostRect.bottom - targetRect.top + gap,
    };
  }

  protected onNameHover(nameEl: HTMLElement, entry: WatchlistEntry): void {
    if (nameEl.scrollWidth <= nameEl.clientWidth) {
      this.nameTooltip.set(null);
      return;
    }
    const tile = nameEl.closest('.kpi') as HTMLElement;
    this.nameTooltip.set({
      text: this.displayName(entry),
      ...this.hostRelativePos(tile, 8),
    });
  }

  protected onNameLeave(): void {
    this.nameTooltip.set(null);
  }

  protected add(result: WakfuSearchResult): void {
    if (result.kind === 'enemy') this.stats.addWatchedEnemy(result.name);
    else this.stats.addWatchedItem(result.name);
    this.addOpen.set(false);
  }

  protected resetCount(name: string): void {
    this.stats.resetWatchedCount(name);
  }

  protected requestDelete(event: Event, name: string): void {
    event.stopPropagation();
    const tile = (event.currentTarget as HTMLElement).closest('.kpi') as HTMLElement;
    this.confirmPopoverPos.set(this.hostRelativePos(tile, 8));
    this.confirmDeleteName.set(name);
  }

  protected confirmDelete(event: Event, name: string): void {
    event.stopPropagation();
    this.stats.removeWatched(name);
    this.confirmDeleteName.set(null);
  }

  protected cancelDelete(event: Event): void {
    event.stopPropagation();
    this.confirmDeleteName.set(null);
  }

  private dragIndex: number | null = null;

  /** Construit une image de drag minimaliste (juste l'icône, sur une tuile
   * neutre) plutôt que de capturer la tuile réelle : celle-ci peut être en
   * cours de transition d'agrandissement au survol et porte des éléments
   * `position:absolute` (badge compteur, croix de suppression) qui, capturés
   * tels quels par `setDragImage`, produisaient un fantôme de drag confus
   * (superposition visible à l'usage). Détachée du DOM après capture (le
   * navigateur lit l'image de façon synchrone lors de l'appel). */
  private buildDragGhost(tile: HTMLElement): HTMLElement {
    const icon = tile.querySelector('.kpi-icon') as HTMLElement | null;
    const ghost = document.createElement('div');
    ghost.style.cssText =
      'position:fixed; top:-1000px; left:-1000px; width:46px; height:46px;' +
      'border-radius:10px; background:#232323; display:flex; align-items:center;' +
      `justify-content:center; border:2px solid ${getComputedStyle(tile).borderColor};`;
    if (icon) {
      const clone = icon.cloneNode(true) as HTMLElement;
      clone.style.margin = '0';
      ghost.appendChild(clone);
    }
    return ghost;
  }

  protected onDragStart(index: number, event: DragEvent): void {
    this.dragIndex = index;
    const tile = event.currentTarget as HTMLElement;
    const ghost = this.buildDragGhost(tile);
    document.body.appendChild(ghost);
    event.dataTransfer?.setDragImage(ghost, 23, 23);
    setTimeout(() => ghost.remove(), 0);
  }

  protected onDrop(index: number): void {
    if (this.dragIndex !== null && this.dragIndex !== index) {
      this.stats.reorderWatchlist(this.dragIndex, index);
    }
    this.dragIndex = null;
  }
}
