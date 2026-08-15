import { computed, signal } from '@angular/core';
import {
  StatsStoreService,
  WatchlistCounterMode,
  WatchlistEntry,
} from '../services/stats-store.service';
import { I18nService } from '../services/i18n.service';
import { ConfirmDeleteService } from '../services/confirm-delete.service';
import { CatalogService } from '../api/catalog.service';
import { getWakfuItemRarity } from '../data/wakfu-item-rarity.data';
import { resolveNumericKeyAction } from './numeric-keydown.util';
import { WakfuSearchResult } from '../services/wakfu-search.service';

/** Identifie une entrée de watchlist de façon unique, y compris quand deux entrées partagent le
 * même nom (catalogue avec homonymes, ex. les deux "Larme d'Ogrest") — utilisé pour tout ce qui
 * doit cibler UNE ligne précise dans ce contrôleur (sélection groupée, `@for track` côté
 * template). Jamais utilisé pour le comptage/la détection depuis le log, qui reste basé sur le
 * nom seul (voir StatsStoreService.incrementWatched). */
export function watchlistEntryKey(entry: Pick<WatchlistEntry, 'name' | 'catalogId'>): string {
  return `${entry.name}::${entry.catalogId ?? ''}`;
}

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
    private readonly catalog: CatalogService,
  ) {}

  /** Mode choisi via le switch à côté de l'autocomplétion — appliqué au KPI créé par `add()` (voir
   * WatchlistCounterMode). Réinitialisé à 'up' après chaque ajout (mobile) / fermeture (desktop). */
  readonly addMode = signal<WatchlistCounterMode>('up');
  /** Cible du décompte choisie au moment de la création (mode 'down' uniquement, voir
   * `.kpi-add-target-input`/`.tracker-add-target-input`) — un KPI décompte n'a plus AUCUN moyen de
   * changer sa cible une fois créé (voir setWatchlistCountdownTarget) : elle doit donc être fixée
   * ICI, avant l'ajout, au même titre que le mode. Réinitialisée avec `addMode` (voir
   * `resetAddForm`). Pas de bornage strict pendant la saisie (voir `onAddTargetInput`) pour ne pas
   * lutter contre l'utilisateur qui efface le champ pour retaper un nombre à deux chiffres — la
   * valeur n'est clampée qu'à l'usage réel, dans `add()`. */
  readonly addTarget = signal<number>(1);

  /**
   * Mode "sélection multiple" : chaque tuile affiche une case à cocher à la place de sa croix de
   * suppression individuelle, et un bouton de suppression groupée est visible dès l'entrée dans
   * ce mode — suppression immédiate au clic, sans popover de confirmation (le passage par ce mode
   * dédié + une sélection explicite tient lieu de confirmation).
   *
   * AUCUNE tuile cochée par défaut (voir `enterSelectMode`) : cocher tout par défaut forcerait à
   * décocher chaque tuile une à une pour n'en supprimer que quelques-unes parmi 10-15 suivies —
   * l'inverse de ce que la sélection multiple sert à faire rapidement. Une sélection VIDE se lit
   * donc comme "aucune exclusion" — le bouton affiche "Supprimer tout" et agit sur l'intégralité
   * de la liste (voir `confirmBulkDelete`) — jusqu'à ce que l'utilisateur coche une ou plusieurs
   * tuiles précises, moment où le bouton bascule sur "Supprimer (N)" et ne cible plus qu'elles.
   * Cocher explicitement TOUTES les tuiles à la main ramène au même libellé "Supprimer tout" par
   * cohérence (même résultat, deux chemins pour y arriver).
   */
  readonly selectMode = signal(false);
  /** Clés composites (voir `watchlistEntryKey`), pas des noms bruts : deux entrées homonymes
   * d'id différent doivent pouvoir être sélectionnées/supprimées indépendamment. */
  readonly selectedKeys = signal<ReadonlySet<string>>(new Set());
  readonly canBulkDelete = computed(() => this.stats.watchlist().length > 2);
  /** "Supprimer tout" quand rien n'est coché (aucune exclusion, voir doc de `selectMode`) ou que
   * tout est coché — "Supprimer (N)" pour une sélection partielle explicite. */
  readonly bulkDeleteLabel = computed(() => {
    const count = this.selectedKeys().size;
    return count === 0 || count === this.stats.watchlist().length
      ? this.i18n.t('tracker.bulkDeleteAllConfirm')
      : this.i18n.t('tracker.bulkDeleteConfirm', { count });
  });

  rarityClass(entry: WatchlistEntry): string {
    return entry.kind === 'item'
      ? `rarity-${getWakfuItemRarity(this.catalog, entry.name, entry.catalogId)}`
      : '';
  }

  displayName(entry: WatchlistEntry): string {
    return entry.kind === 'item'
      ? this.i18n.translateItemName(entry.name)
      : this.i18n.translateMonsterName(entry.name);
  }

  enterSelectMode(): void {
    this.selectMode.set(true);
  }

  exitSelectMode(): void {
    this.selectMode.set(false);
    this.selectedKeys.set(new Set());
  }

  isSelected(entry: WatchlistEntry): boolean {
    return this.selectedKeys().has(watchlistEntryKey(entry));
  }

  toggleSelected(entry: WatchlistEntry): void {
    const key = watchlistEntryKey(entry);
    this.selectedKeys.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Supprime les tuiles cochées en un clic, sans popover de confirmation — le passage par le
   * mode sélection puis une sélection explicite (ou son absence, voir doc de `selectMode`)
   * tiennent lieu de confirmation. Sélection vide : supprime TOUT (aucune exclusion cochée). */
  confirmBulkDelete(): void {
    const selected = this.selectedKeys();
    const deleteAll = selected.size === 0;
    for (const entry of this.stats.watchlist()) {
      if (deleteAll || selected.has(watchlistEntryKey(entry))) {
        this.stats.removeWatched(entry.name, entry.catalogId);
      }
    }
    this.exitSelectMode();
  }

  resetCount(event: Event, entry: WatchlistEntry): void {
    event.stopPropagation();
    this.stats.resetWatchedCount(entry.name, entry.catalogId);
  }

  /** Édition directe de la valeur ACTUELLE du décompte (mode 'down') — la cible, elle, ne se
   * modifie plus après la création (voir addTarget/add()). */
  onCountdownInput(event: Event, entry: WatchlistEntry): void {
    event.stopPropagation();
    const value = Number((event.target as HTMLInputElement).value);
    this.stats.setWatchlistCurrentCount(entry.name, value, entry.catalogId);
  }

  /** Restreint l'input aux chiffres et pilote la valeur via les flèches haut/bas — voir
   * resolveNumericKeyAction. Bornée à `entry.countdownTarget` (la cible ne bouge plus). */
  onCountdownKeydown(event: KeyboardEvent, entry: WatchlistEntry): void {
    event.stopPropagation();
    const action = resolveNumericKeyAction(event);
    if (action === 'block') {
      event.preventDefault();
    } else if (action === 'increment') {
      event.preventDefault();
      this.stats.setWatchlistCurrentCount(
        entry.name,
        Math.min(entry.countdownTarget, entry.count + 1),
        entry.catalogId,
      );
    } else if (action === 'decrement') {
      event.preventDefault();
      this.stats.setWatchlistCurrentCount(
        entry.name,
        Math.max(0, entry.count - 1),
        entry.catalogId,
      );
    }
  }

  /** Pourcentage d'avancement d'un décompte : part de 0% (cible tout juste choisie) à 100% (0
   * restant). Toujours 0 pour une cible nulle (entrée pas encore configurée) — évite une division
   * par zéro plutôt qu'un NaN affiché. */
  countdownPercent(entry: WatchlistEntry): number {
    return entry.countdownTarget > 0
      ? Math.round(((entry.countdownTarget - entry.count) / entry.countdownTarget) * 100)
      : 0;
  }

  /** Texte du tooltip du badge de mode (coin haut-gauche de la tuile/carte, voir
   * `.kpi-mode-badge`/`.kpi-card-mode-badge`) — mêmes clés que le switch du formulaire d'ajout. */
  modeTooltip(entry: WatchlistEntry): string {
    return this.i18n.t(entry.mode === 'up' ? 'tracker.countUpMode' : 'tracker.countDownMode');
  }

  /** Texte du tooltip affiché au survol d'une tuile décompte EN MODE COMPACT (bande desktop
   * uniquement, voir tracker-strip.component.html) : seul moyen d'y voir le pourcentage tant que
   * la tuile n'est pas ouverte (plus de barre de progression, jugée trop lourde pour 58px). */
  countdownProgressTooltip(entry: WatchlistEntry): string {
    return this.i18n.t('tracker.countdownProgressTooltip', {
      percent: this.countdownPercent(entry),
    });
  }

  /** Saisie de la cible au moment de la création (voir addTarget) — pas de clamp ici (voir doc du
   * signal) : seul `add()` borne la valeur réellement utilisée. */
  onAddTargetInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.addTarget.set(Number.isFinite(value) ? value : 0);
  }

  /** Même filtrage chiffres-only + flèches haut/bas que `onCountdownKeydown`, pour le champ de
   * cible du formulaire d'ajout (pas d'entrée existante à cibler ici, juste le signal `addTarget`). */
  onAddTargetKeydown(event: KeyboardEvent): void {
    const action = resolveNumericKeyAction(event);
    if (action === 'block') {
      event.preventDefault();
    } else if (action === 'increment') {
      event.preventDefault();
      this.addTarget.update((v) => v + 1);
    } else if (action === 'decrement') {
      event.preventDefault();
      this.addTarget.update((v) => Math.max(0, v - 1));
    }
  }

  /** Crée le KPI choisi dans l'autocomplétion, avec le mode (et en décompte, la cible) choisis
   * dans le formulaire d'ajout — logique partagée entre la bande desktop et la grille mobile.
   * Cible bornée à 1 minimum ici (jamais pendant la saisie, voir addTarget) : un décompte à cible
   * 0 afficherait un pourcentage toujours à 0 (countdownPercent) sans jamais pouvoir avancer. */
  add(result: WakfuSearchResult): void {
    if (result.kind === 'enemy') this.stats.addWatchedEnemy(result.name, result.id);
    else this.stats.addWatchedItem(result.name, result.id);
    if (this.addMode() === 'down') {
      this.stats.setWatchlistMode(result.name, 'down', result.id);
      const target = Math.floor(this.addTarget());
      this.stats.setWatchlistCountdownTarget(
        result.name,
        Number.isFinite(target) && target > 0 ? target : 1,
        result.id,
      );
    }
    this.resetAddForm();
  }

  /** Remet le formulaire d'ajout à son état par défaut — appelée après une création réussie
   * (`add()`) et après un abandon (fermeture de la recherche sans avoir choisi de résultat). */
  resetAddForm(): void {
    this.addMode.set('up');
    this.addTarget.set(1);
  }

  /** `onRequested`/`onRemoved` : hooks optionnels pour les besoins propres à chaque vue (ex.
   * tracker-strip suit quelle tuile a sa popover ouverte pour ne pas la refermer au survol, et
   * réinitialise sa tuile active une fois l'entrée supprimée — voir tracker-strip.component.ts). */
  requestDelete(
    event: Event,
    entry: WatchlistEntry,
    onRequested?: () => void,
    onRemoved?: () => void,
  ): void {
    event.stopPropagation();
    onRequested?.();
    const button = event.currentTarget as HTMLElement;
    this.confirmDelete.open(button, this.i18n.t('tracker.confirmDelete'), () => {
      this.stats.removeWatched(entry.name, entry.catalogId);
      onRemoved?.();
    });
  }
}
