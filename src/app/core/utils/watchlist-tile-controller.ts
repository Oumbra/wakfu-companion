import { computed, signal } from '@angular/core';
import {
  StatsStoreService,
  WatchlistCounterMode,
  WatchlistEntry,
} from '../services/stats-store.service';
import { I18nService } from '../services/i18n.service';
import { ConfirmDeleteService } from '../services/confirm-delete.service';
import { getWakfuItemRarity } from '../data/wakfu-item-rarity.data';
import { resolveNumericKeyAction } from './numeric-keydown.util';

/**
 * Logique commune aux deux vues de la watchlist (TrackerComponent mobile en grille de cartes,
 * TrackerStripComponent desktop en bande de KPI) : même modèle (WatchlistEntry), mêmes actions de
 * base (rareté/nom affiché/troncature, sélection multiple + suppression groupée, reset/mode de
 * comptage, suppression individuelle confirmée via ConfirmDeleteService). Instanciée en tant que
 * simple champ (pas de DI, pas d'héritage) par chaque composant plutôt que fournie par Angular :
 * chaque composant reste seul responsable de ce qui est propre à sa mise en page (survol/scroll/
 * drag&drop desktop pour tracker-strip, tactile pour tracker) — voir CLAUDE.md, aucune perte de
 * fonctionnalité/design entre les deux implémentations d'origine.
 */
export class WatchlistTileController {
  constructor(
    private readonly stats: StatsStoreService,
    private readonly i18n: I18nService,
    private readonly confirmDelete: ConfirmDeleteService,
  ) {}

  /** Noms actuellement tronqués par l'ellipsis CSS (détecté au survol, voir `checkTruncation`) :
   * seuls ceux-là reçoivent un `title`, pour n'afficher la tooltip que quand le nom complet n'est
   * pas déjà visible. */
  readonly truncatedNames = signal<ReadonlySet<string>>(new Set());

  /** Mode choisi via le switch à côté de l'autocomplétion — appliqué au KPI créé par `add()` (voir
   * WatchlistCounterMode). Réinitialisé à 'up' après chaque ajout (mobile) / fermeture (desktop). */
  readonly addMode = signal<WatchlistCounterMode>('up');

  /** Mode "sélection multiple" : chaque tuile affiche une case à cocher à la place de sa croix de
   * suppression individuelle, et un bouton "Supprimer (N)" apparaît dès qu'au moins une tuile est
   * cochée — suppression immédiate au clic, sans popover de confirmation (le passage par ce mode
   * dédié + une sélection explicite tient lieu de confirmation). */
  readonly selectMode = signal(false);
  readonly selectedNames = signal<ReadonlySet<string>>(new Set());
  readonly canBulkDelete = computed(() => this.stats.watchlist().length > 2);
  readonly bulkDeleteLabel = computed(() =>
    this.i18n.t('tracker.bulkDeleteConfirm', { count: this.selectedNames().size }),
  );

  rarityClass(entry: WatchlistEntry): string {
    return entry.kind === 'item' ? `rarity-${getWakfuItemRarity(entry.name)}` : '';
  }

  displayName(entry: WatchlistEntry): string {
    return entry.kind === 'item'
      ? this.i18n.translateItemName(entry.name)
      : this.i18n.translateMonsterName(entry.name);
  }

  checkTruncation(el: HTMLElement, name: string): void {
    const isTruncated = el.scrollWidth > el.clientWidth;
    const current = this.truncatedNames();
    if (isTruncated === current.has(name)) return;
    const updated = new Set(current);
    if (isTruncated) updated.add(name);
    else updated.delete(name);
    this.truncatedNames.set(updated);
  }

  enterSelectMode(): void {
    this.selectMode.set(true);
  }

  exitSelectMode(): void {
    this.selectMode.set(false);
    this.selectedNames.set(new Set());
  }

  toggleSelected(name: string): void {
    this.selectedNames.update((set) => {
      const next = new Set(set);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  /** Supprime toutes les tuiles cochées en un clic, sans popover de confirmation — le passage par
   * le mode sélection puis une sélection explicite tiennent lieu de confirmation. */
  confirmBulkDelete(): void {
    for (const name of this.selectedNames()) {
      this.stats.removeWatched(name);
    }
    this.exitSelectMode();
  }

  resetCount(event: Event, name: string): void {
    event.stopPropagation();
    this.stats.resetWatchedCount(name);
  }

  setMode(event: Event, name: string, mode: WatchlistCounterMode): void {
    event.stopPropagation();
    this.stats.setWatchlistMode(name, mode);
  }

  /** Édition directe de la valeur de départ du décompte (mode 'down'). */
  onCountdownInput(event: Event, name: string): void {
    event.stopPropagation();
    const value = Number((event.target as HTMLInputElement).value);
    this.stats.setWatchlistCountdownTarget(name, value);
  }

  /** Restreint l'input aux chiffres et pilote la valeur via les flèches haut/bas — voir
   * resolveNumericKeyAction. */
  onCountdownKeydown(event: KeyboardEvent, entry: WatchlistEntry): void {
    event.stopPropagation();
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

  /** `onRequested`/`onRemoved` : hooks optionnels pour les besoins propres à chaque vue (ex.
   * tracker-strip suit quelle tuile a sa popover ouverte pour ne pas la refermer au survol, et
   * réinitialise sa tuile active une fois l'entrée supprimée — voir tracker-strip.component.ts). */
  requestDelete(
    event: Event,
    name: string,
    onRequested?: () => void,
    onRemoved?: () => void,
  ): void {
    event.stopPropagation();
    onRequested?.();
    const button = event.currentTarget as HTMLElement;
    this.confirmDelete.open(button, this.i18n.t('tracker.confirmDelete'), () => {
      this.stats.removeWatched(name);
      onRemoved?.();
    });
  }
}
