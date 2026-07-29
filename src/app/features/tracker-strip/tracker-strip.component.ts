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

/** Délai (ms) de survol avant qu'un KPI ne se déploie — évite une ouverture
 * parasite en balayant la bande du regard/de la souris. Seul point à
 * modifier pour ajuster ce réglage (répercuté en JS ici et en CSS via la
 * variable `--kpi-expand-duration`, voir template). */
const KPI_HOVER_INTENT_DELAY_MS = 500;
/** Durée (ms) de l'animation d'ouverture/fermeture d'un KPI — largeur ET
 * contenu (nom/compteur/reset) partagent exactement cette même valeur pour
 * rester parfaitement synchronisés (voir tracker-strip.component.css). */
const KPI_EXPAND_DURATION_MS = 320;
/** Largeur cible (px) d'un KPI déployé — utilisée à la fois en CSS
 * (min-width) et pour calculer la position de défilement cible (voir
 * `scrollTileIntoView`, qui ne peut pas se fier à la largeur réelle au
 * moment du calcul : elle vaut encore 58px avant que la transition ne
 * démarre). */
const KPI_EXPANDED_WIDTH_PX = 210;

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

  protected readonly hoverIntentDelayMs = KPI_HOVER_INTENT_DELAY_MS;
  protected readonly expandDurationMs = KPI_EXPAND_DURATION_MS;
  protected readonly expandedWidthPx = KPI_EXPANDED_WIDTH_PX;

  protected readonly existingNames = computed(() =>
    this.stats.watchlist().map((w) => ({ name: w.name, kind: w.kind })),
  );

  protected readonly addOpen = signal(false);
  /** Nom de l'entrée dont la popover de confirmation de suppression est actuellement ouverte (une seule à la fois). */
  protected readonly confirmDeleteName = signal<string | null>(null);
  /** Position (right/top, relative au host) de la popover ouverte — voir `hostRelativePos`. */
  protected readonly confirmPopoverPos = signal<{ right: number; top: number } | null>(null);
  /** Tooltip du nom tronqué actuellement survolé (texte + position relative au host) — voir
   * `hostRelativePos` : ne peut pas être un simple `[title]`/`[data-tooltip]` CSS ici, la classe
   * globale `[title]::after` (styles.css) serait de toute façon rognée par `.kpi-strip`
   * (`overflow-y:hidden`, scroll horizontal seul), donc positionnée en JS comme la popover de
   * suppression plutôt que de dupliquer le système CSS générique dans ce contexte particulier. */
  protected readonly nameTooltip = signal<{ text: string; right: number; bottom: number } | null>(
    null,
  );

  /** Nom du KPI actuellement déployé — une seule tuile à la fois, pilotée en
   * JS (pas de simple `:hover` CSS) pour pouvoir imposer un délai avant
   * ouverture ET un verrou anti-cascade (voir `onTileEnter`/`onTileLeave`) :
   * avec un déploiement qui repousse réellement les tuiles voisines, une
   * fermeture peut faire reculer une autre tuile sous une souris restée
   * immobile, qui se retrouve alors "survolée" sans mouvement réel — un vrai
   * effet de cascade en chaîne, identifié en analysant une vidéo image par
   * image (voir historique du projet). */
  protected readonly activeName = signal<string | null>(null);
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  /** Horodatage jusqu'auquel un nouveau survol est ignoré, le temps que la
   * tuile qui vient de se refermer termine son animation — c'est ce délai
   * qui neutralise le risque de cascade décrit ci-dessus : tant que le
   * repli n'est pas terminé, aucune nouvelle tuile ne peut démarrer son
   * propre délai de survol, quel que soit ce qui se retrouve sous la souris
   * entre-temps. */
  private blockedUntilMs = 0;

  /** Voir tracker.component.ts : mêmes règles de détection de troncature. */
  private readonly truncatedNames = signal<ReadonlySet<string>>(new Set());

  protected rarityClass(entry: WatchlistEntry): string {
    return entry.kind === 'item' ? `rarity-${getWakfuItemRarity(entry.name)}` : '';
  }

  protected displayName(entry: WatchlistEntry): string {
    return entry.kind === 'item'
      ? this.i18n.translateItemName(entry.name)
      : this.i18n.translateMonsterName(entry.name);
  }

  protected isTruncated(name: string): boolean {
    return this.truncatedNames().has(name);
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

  protected onTileEnter(event: MouseEvent, name: string): void {
    if (Date.now() < this.blockedUntilMs) return;
    if (this.activeName() !== null && this.activeName() !== name) return;
    this.clearHoverTimer();
    const tile = event.currentTarget as HTMLElement;
    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = null;
      this.activeName.set(name);
      this.scrollTileIntoView(tile);
    }, KPI_HOVER_INTENT_DELAY_MS);
  }

  protected onTileLeave(name: string): void {
    this.clearHoverTimer();
    // Le rétrécissement de la tuile ne doit pas se produire pendant que sa
    // popover de confirmation de suppression est ouverte : l'apparition de
    // `.confirm-backdrop` (position:fixed, plein écran) juste sous le
    // curseur déclenche un `mouseleave` synthétique sur la tuile côté
    // Chromium (le pointeur n'a pourtant pas bougé), ce qui refermait la
    // tuile alors que la popover, elle, restait positionnée d'après sa
    // géométrie déployée — décalage visible signalé par l'utilisateur.
    if (this.confirmDeleteName() === name) return;
    if (this.activeName() !== name) return;
    this.activeName.set(null);
    this.blockedUntilMs = Date.now() + KPI_EXPAND_DURATION_MS;
  }

  /** Ouverture/fermeture au clic, en plus du survol (délai ignoré). Les
   * clics sur les boutons reset/suppression internes stoppent leur propre
   * propagation (voir `resetCount`/`requestDelete`) et n'atteignent donc
   * jamais ce handler. */
  protected onTileClick(event: MouseEvent, name: string): void {
    this.clearHoverTimer();
    if (this.activeName() === name) {
      this.activeName.set(null);
      this.blockedUntilMs = Date.now() + KPI_EXPAND_DURATION_MS;
      return;
    }
    this.activeName.set(name);
    this.scrollTileIntoView(event.currentTarget as HTMLElement);
  }

  private clearHoverTimer(): void {
    if (this.hoverTimer !== null) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
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

  /** Position (right/bottom en px) d'un élément relativement au host — sert à sortir les
   * popovers/tooltips de `.kpi-strip` (qui les rognerait via son overflow) sans pour autant les
   * ancrer en `position:fixed` (le host vit sous `.view-slider`, qui porte un `transform` :
   * `position:fixed` s'y positionnerait relativement à cet ancêtre, pas au viewport — voir
   * CLAUDE.md). `:host{position:relative}`, sans overflow, sert donc de containing block. */
  private hostRelativePos(
    target: HTMLElement,
    gap: number,
  ): { right: number; top: number; bottom: number } {
    const hostRect = this.elementRef.nativeElement.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    return {
      right: hostRect.right - targetRect.right - gap,
      // Au-dessus de `target` (tooltip de nom).
      bottom: hostRect.bottom - targetRect.top + gap,
      // En dessous de `target` (popover de suppression).
      top: targetRect.bottom - hostRect.top + gap,
    };
  }

  protected onNameHover(nameEl: HTMLElement, entry: WatchlistEntry): void {
    if (nameEl.scrollWidth <= nameEl.clientWidth) {
      this.nameTooltip.set(null);
      return;
    }
    // Positionné par rapport au libellé lui-même (pas toute la tuile) pour
    // s'afficher juste au-dessus du texte, quelle que soit la largeur réelle
    // de la tuile déployée.
    const { right, bottom } = this.hostRelativePos(nameEl, 8);
    this.nameTooltip.set({ text: this.displayName(entry), right, bottom });
  }

  protected onNameLeave(): void {
    this.nameTooltip.set(null);
  }

  protected add(result: WakfuSearchResult): void {
    if (result.kind === 'enemy') this.stats.addWatchedEnemy(result.name);
    else this.stats.addWatchedItem(result.name);
    this.addOpen.set(false);
  }

  protected resetCount(event: Event, name: string): void {
    event.stopPropagation();
    this.stats.resetWatchedCount(name);
  }

  protected requestDelete(event: Event, name: string): void {
    event.stopPropagation();
    // Ancré sur le bouton × lui-même (pas toute la tuile) : la popover
    // s'affiche juste en dessous de la croix, alignée sur sa droite.
    const button = event.currentTarget as HTMLElement;
    const { right, top } = this.hostRelativePos(button, 8);
    this.confirmPopoverPos.set({ right, top });
    this.confirmDeleteName.set(name);
  }

  protected confirmDelete(event: Event, name: string): void {
    event.stopPropagation();
    this.stats.removeWatched(name);
    this.confirmDeleteName.set(null);
    if (this.activeName() === name) this.activeName.set(null);
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
    // Le drag démarre parfois sans mouseleave fiable (comportement natif du
    // navigateur) : on referme explicitement plutôt que de risquer une
    // tuile restée "déployée" alors qu'elle est en train d'être déplacée.
    this.clearHoverTimer();
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
