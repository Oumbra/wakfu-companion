import { Component, computed, ElementRef, inject, signal } from '@angular/core';
import {
  StatsStoreService,
  WatchlistCounterMode,
  WatchlistEntry,
} from '../../core/services/stats-store.service';
import { EntityIconComponent } from '../../shared/entity-icon/entity-icon.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { WakfuAutocompleteComponent } from '../../shared/wakfu-autocomplete/wakfu-autocomplete.component';
import { WakfuSearchResult } from '../../core/services/wakfu-search.service';
import { ConfirmDeleteService } from '../../core/services/confirm-delete.service';
import { HelpModalService } from '../../core/services/help-modal.service';
import { WatchlistTileController } from '../../core/utils/watchlist-tile-controller';
import { IconComponent } from '../../shared/icon/icon.component';
import { CatalogService } from '../../core/api/catalog.service';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';

/** Durée (ms) de l'animation d'ouverture/fermeture d'un KPI — largeur ET
 * contenu (nom/compteur/reset) partagent exactement cette même valeur pour
 * rester parfaitement synchronisés (voir tracker-strip.component.css). */
const KPI_EXPAND_DURATION_MS = 320;
/** Largeur cible (px) d'un KPI déployé — utilisée à la fois en CSS
 * (min-width) et pour calculer la position de défilement cible (voir
 * `scrollTileIntoView`, qui ne peut pas se fier à la largeur réelle au
 * moment du calcul : elle vaut encore 58px avant que la transition ne
 * démarre). */
const KPI_EXPANDED_WIDTH_PX = 250;

/**
 * Suivi (desktop) : bande horizontale de KPI compacts au-dessus de la ligne
 * de panneaux (voir dashboard.component.html), sans fond ni bordure propres
 * — chaque tuile se déploie au CLIC pour révéler nom + compteur + reset (le
 * survol seul n'ouvre plus rien, voir CLAUDE.md : seuls deux tooltips
 * natifs réagissent au survol, badge de mode et % de progression en
 * décompte). Masqué en dessous du breakpoint mobile (voir CSS) : le mobile
 * garde Suivi comme un onglet à part entière, affiché par TrackerComponent
 * (grille de cartes).
 *
 * La logique commune avec TrackerComponent (rareté/nom affiché/troncature, sélection multiple,
 * création/mode/cible, édition de la valeur courante en décompte, suppression confirmée) vit dans
 * WatchlistTileController — ce composant ne garde que ce qui est propre à la bande desktop
 * (ouverture/fermeture au clic, tooltip de nom positionné en JS, drag&drop de réordonnancement).
 */
@Component({
  selector: 'app-tracker-strip',
  imports: [
    NumberFrPipe,
    EntityIconComponent,
    ItemIconComponent,
    TranslatePipe,
    WakfuAutocompleteComponent,
    IconComponent,
    TooltipDirective,
  ],
  templateUrl: './tracker-strip.component.html',
  styleUrl: './tracker-strip.component.css',
})
export class TrackerStripComponent {
  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);
  private readonly confirmDelete = inject(ConfirmDeleteService);
  private readonly catalog = inject(CatalogService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  protected readonly helpModal = inject(HelpModalService);

  protected readonly watchlist = new WatchlistTileController(
    this.stats,
    this.i18n,
    this.confirmDelete,
    this.catalog,
  );

  protected readonly expandDurationMs = KPI_EXPAND_DURATION_MS;
  protected readonly expandedWidthPx = KPI_EXPANDED_WIDTH_PX;

  protected readonly existingNames = computed(() =>
    this.stats.watchlist().map((w) => ({ name: w.name, kind: w.kind, id: w.catalogId })),
  );

  protected readonly firstEntryHasLongCount = computed(() => {
    const entries = this.stats.watchlist();
    return entries.length > 0 ? this.watchlist.isLongCount(entries[0]) : false;
  });

  protected readonly addOpen = signal(false);

  /** Nom du KPI actuellement déployé — une seule tuile à la fois, pilotée en JS (pas de `:hover`
   * CSS) et exclusivement par clic (voir `onTileClick`) : plus de délai/verrou anti-cascade à
   * gérer ici, un clic n'a pas les faux déclenchements d'un survol qui balaie la bande. */
  protected readonly activeName = signal<string | null>(null);

  /** Seul déclencheur d'ouverture/fermeture d'une tuile (voir CLAUDE.md — le survol n'ouvre plus
   * rien). Les clics sur les boutons/inputs internes (reset, suppression, valeur actuelle du
   * décompte) stoppent leur propre propagation et n'atteignent donc jamais ce handler. */
  protected onTileClick(event: MouseEvent, entry: WatchlistEntry): void {
    if (this.watchlist.selectMode()) {
      this.watchlist.toggleSelected(entry);
      return;
    }
    const name = entry.name;
    if (this.activeName() === name) {
      this.activeName.set(null);
      return;
    }
    this.activeName.set(name);
    this.scrollTileIntoView(event.currentTarget as HTMLElement);
  }

  /** Fait défiler la bande pour amener la tuile déployée au centre — ou, si
   * elle est trop proche de la fin de la liste pour être centrée, la
   * rapproche au maximum du bord droit (la cible est simplement bornée par
   * le scroll maximal disponible, ce qui couvre les deux cas demandés en un
   * seul calcul). */
  private scrollTileIntoView(tile: HTMLElement): void {
    const strip = this.elementRef.nativeElement.querySelector('.kpi-strip') as HTMLElement | null;
    if (!strip) return;
    const stripRect = strip.getBoundingClientRect();
    const tileRect = tile.getBoundingClientRect();
    const tileLeftInStrip = tileRect.left - stripRect.left + strip.scrollLeft;
    const expandedCenter = tileLeftInStrip + KPI_EXPANDED_WIDTH_PX / 2;
    const targetScrollLeft = expandedCenter - strip.clientWidth / 2;
    const maxScrollLeft = strip.scrollWidth - strip.clientWidth;
    strip.scrollTo({
      left: Math.max(0, Math.min(targetScrollLeft, maxScrollLeft)),
      behavior: 'smooth',
    });
  }

  protected add(result: WakfuSearchResult): void {
    this.watchlist.add(result);
    this.closeAdd();
  }

  protected setAddMode(event: Event, mode: WatchlistCounterMode): void {
    event.stopPropagation();
    this.watchlist.addMode.set(mode);
  }

  protected closeAdd(): void {
    this.addOpen.set(false);
    this.watchlist.resetAddForm();
  }

  /** Ouvre le formulaire d'ajout — quitte le mode sélection au passage : les deux modes
   * (ajout/suppression groupée) n'ont pas de raison d'être actifs simultanément. */
  protected openAdd(): void {
    this.watchlist.exitSelectMode();
    this.addOpen.set(true);
  }

  /** Bascule le mode sélection (bouton "-") : un second clic pendant que le mode est actif le
   * quitte sans rien supprimer, quelle que soit la sélection en cours. */
  protected toggleSelectMode(): void {
    if (this.watchlist.selectMode()) {
      this.watchlist.exitSelectMode();
      return;
    }
    this.activeName.set(null);
    this.watchlist.enterSelectMode();
  }

  protected requestDelete(event: Event, entry: WatchlistEntry): void {
    const name = entry.name;
    this.watchlist.requestDelete(event, entry, undefined, () => {
      if (this.activeName() === name) this.activeName.set(null);
    });
  }

  private dragIndex: number | null = null;

  /** Construit une image de drag minimaliste (juste l'icône, sur une tuile
   * neutre) plutôt que de capturer la tuile réelle : celle-ci peut être en
   * cours de transition d'agrandissement au clic et porte des éléments
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
    // Le drag démarre parfois sans mouseleave fiable (comportement natif du
    // navigateur) : on referme explicitement plutôt que de risquer une
    // tuile restée "déployée" alors qu'elle est en train d'être déplacée.
    this.activeName.set(null);
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
