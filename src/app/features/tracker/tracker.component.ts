import { Component, computed, inject, signal } from '@angular/core';
import {
  StatsStoreService,
  WatchlistCounterMode,
  WatchlistEntry,
} from '../../core/services/stats-store.service';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { EntityIconComponent } from '../../shared/entity-icon/entity-icon.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { WakfuAutocompleteComponent } from '../../shared/wakfu-autocomplete/wakfu-autocomplete.component';
import { WakfuSearchResult } from '../../core/services/wakfu-search.service';
import { getWakfuItemRarity } from '../../core/data/wakfu-item-rarity.data';
import { resolveNumericKeyAction } from '../../core/utils/numeric-keydown.util';
import { ConfirmDeleteService } from '../../core/services/confirm-delete.service';

/**
 * Suivi (mobile) : grille de cartes en flex-wrap (voir CLAUDE.md, même
 * principe que `.sound-item-grid` de la page profil), affichée uniquement
 * en dessous du breakpoint mobile (voir CSS) — au-dessus, Suivi est une
 * bande persistante rendue par TrackerStripComponent, pas un onglet.
 */
@Component({
  selector: 'app-tracker',
  imports: [NumberFrPipe, EntityIconComponent, ItemIconComponent, TranslatePipe, WakfuAutocompleteComponent],
  templateUrl: './tracker.component.html',
  styleUrl: './tracker.component.css',
})
export class TrackerComponent {
  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);
  private readonly confirmDelete = inject(ConfirmDeleteService);

  protected readonly existingNames = computed(() =>
    this.stats.watchlist().map((w) => ({ name: w.name, kind: w.kind })),
  );

  /** Noms actuellement tronqués par l'ellipsis CSS (détecté au survol, voir
   * `checkTruncation`) : seuls ceux-là reçoivent un `title`, pour n'afficher
   * la tooltip que quand le nom complet n'est pas déjà visible. */
  protected readonly truncatedNames = signal<ReadonlySet<string>>(new Set());

  /** Mode choisi via le switch à côté de l'autocomplétion — appliqué au KPI créé par `add()` (voir
   * WatchlistCounterMode). Réinitialisé à 'up' après chaque ajout. */
  protected readonly addMode = signal<WatchlistCounterMode>('up');

  /** Mode "sélection multiple" (mobile) — même principe que tracker-strip.component.ts (desktop) :
   * chaque carte affiche une case à cocher à la place de sa croix de suppression individuelle, et
   * un bouton "Supprimer (N)" apparaît dès qu'au moins une carte est cochée — suppression
   * immédiate au clic, sans popover de confirmation (le passage par ce mode dédié + une sélection
   * explicite tient lieu de confirmation). Un second clic sur le bouton "-" quitte ce mode sans
   * rien supprimer. */
  protected readonly selectMode = signal(false);
  protected readonly canBulkDelete = computed(() => this.stats.watchlist().length > 2);
  protected readonly selectedNames = signal<ReadonlySet<string>>(new Set());
  protected readonly bulkDeleteLabel = computed(() =>
    this.i18n.t('tracker.bulkDeleteConfirm', { count: this.selectedNames().size }),
  );

  protected rarityClass(entry: WatchlistEntry): string {
    return entry.kind === 'item' ? `rarity-${getWakfuItemRarity(entry.name)}` : '';
  }

  protected displayName(entry: WatchlistEntry): string {
    return entry.kind === 'item'
      ? this.i18n.translateItemName(entry.name)
      : this.i18n.translateMonsterName(entry.name);
  }

  protected checkTruncation(el: HTMLElement, name: string): void {
    const isTruncated = el.scrollWidth > el.clientWidth;
    const current = this.truncatedNames();
    if (isTruncated === current.has(name)) return;
    const updated = new Set(current);
    if (isTruncated) updated.add(name);
    else updated.delete(name);
    this.truncatedNames.set(updated);
  }

  protected add(result: WakfuSearchResult): void {
    if (result.kind === 'enemy') {
      this.stats.addWatchedEnemy(result.name);
    } else {
      this.stats.addWatchedItem(result.name);
    }
    if (this.addMode() === 'down') this.stats.setWatchlistMode(result.name, 'down');
    this.addMode.set('up');
  }

  protected setAddMode(mode: WatchlistCounterMode): void {
    this.addMode.set(mode);
  }

  /** Bascule le mode sélection (bouton "-") : un second clic pendant que le mode est actif le
   * quitte sans rien supprimer, quelle que soit la sélection en cours. */
  protected toggleSelectMode(): void {
    if (this.selectMode()) {
      this.exitSelectMode();
      return;
    }
    this.selectMode.set(true);
  }

  private exitSelectMode(): void {
    this.selectMode.set(false);
    this.selectedNames.set(new Set());
  }

  protected toggleSelected(name: string): void {
    this.selectedNames.update((set) => {
      const next = new Set(set);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  /** Clic sur la carte entière (pas seulement la case à cocher) : plus grande zone tactile en
   * mode sélection — sans effet en mode normal (pas de comportement de survol/dépli sur mobile). */
  protected onCardClick(name: string): void {
    if (!this.selectMode()) return;
    this.toggleSelected(name);
  }

  /** Supprime toutes les cartes cochées en un clic, sans popover de confirmation — le passage par
   * le mode sélection puis une sélection explicite tiennent lieu de confirmation. */
  protected confirmBulkDelete(): void {
    for (const name of this.selectedNames()) {
      this.stats.removeWatched(name);
    }
    this.exitSelectMode();
  }

  protected resetCount(name: string): void {
    this.stats.resetWatchedCount(name);
  }

  protected setMode(name: string, mode: WatchlistCounterMode): void {
    this.stats.setWatchlistMode(name, mode);
  }

  /** Édition directe de la valeur de départ du décompte (mode 'down') — voir `.kpi-card-countdown-input`. */
  protected onCountdownInput(event: Event, name: string): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.stats.setWatchlistCountdownTarget(name, value);
  }

  /** Restreint l'input aux chiffres et pilote la valeur via les flèches haut/bas — voir
   * resolveNumericKeyAction. */
  protected onCountdownKeydown(event: KeyboardEvent, entry: WatchlistEntry): void {
    const action = resolveNumericKeyAction(event);
    if (action === 'block') {
      event.preventDefault();
    } else if (action === 'increment') {
      event.preventDefault();
      this.stats.setWatchlistCountdownTarget(entry.name, entry.count + 1);
    } else if (action === 'decrement') {
      event.preventDefault();
      this.stats.setWatchlistCountdownTarget(entry.name, Math.max(0, entry.count - 1));
    }
  }

  protected requestDelete(event: Event, name: string): void {
    event.stopPropagation();
    const button = event.currentTarget as HTMLElement;
    this.confirmDelete.open(button, this.i18n.t('tracker.confirmDelete'), () => {
      this.stats.removeWatched(name);
    });
  }
}
