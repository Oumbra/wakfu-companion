import { Component, computed, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export type DashboardMenuPos = 'left' | 'right' | 'top-left' | 'top-right';
export type DashboardKpiPos = 'top' | 'bottom' | 'left' | 'right';

/** Une paire de clés à échanger (voir `interactive`/`swap`) — les clés sont celles fournies par
 * l'appelant via `DashboardLayoutSchemaCell.key` (opaques pour ce composant, jamais interprétées
 * ici : juste renvoyées telles quelles dans l'événement). */
export interface DashboardLayoutSchemaSwap {
  readonly a: string;
  readonly b: string;
}

/** Une "carte" schématisée du corps — la couleur seule suffit à l'identifier par défaut (voir
 * légende dans `DashboardLayoutPickerComponent`) ; `label`/`key` sont optionnels et n'entrent en jeu
 * que pour l'aperçu réel (pas les vignettes purement illustratives de préréglage) et l'éditeur
 * d'ordre interactif — ce composant reste décoratif/structurel par défaut, jamais responsable de la
 * traduction des libellés (le texte arrive déjà traduit). */
export interface DashboardLayoutSchemaCell {
  readonly sw: 'combats' | 'purchases' | 'trades' | 'pacts' | 'history' | 'chat' | 'recap';
  /** Dernière carte d'une répartition à nombre impair : occupe toute la largeur de sa ligne (voir
   * `DashboardLayoutPickerComponent.previewCells`, même règle que la grille réelle envisagée). */
  readonly span2?: boolean;
  /** Texte affiché par-dessus la couleur (voir CLAUDE.md, retour utilisateur : se repérer par une
   * légende de couleur séparée était jugé peu lisible) — absent sur les vignettes de préréglage
   * (illustratives, toujours les 4 mêmes cartes fictives), présent sur l'aperçu réel. */
  readonly label?: string;
  /** Identifiant opaque renvoyé par `swap` (voir `interactive`) — obligatoire pour toute carte
   * utilisée dans l'éditeur d'ordre, inutile (et absent) sur les vignettes non interactives. */
  readonly key?: string;
}
export interface DashboardLayoutSchemaFocus {
  readonly main: DashboardLayoutSchemaCell;
  readonly secondaries: readonly DashboardLayoutSchemaCell[];
}

/**
 * Mini-schéma du tableau de bord (en-tête + menu + objectifs + corps) — moteur générique commun
 * aux vignettes des cartes de préréglage ET au grand aperçu en direct de
 * `DashboardLayoutPickerComponent` (voir CLAUDE.md, "toujours un composant, jamais un bloc
 * local répété"). Purement présentationnel : `menuPos`/`kpiPos` positionnent deux barres via un
 * double `flex-direction` imbriqué (menu englobe [objectifs + corps], objectifs englobe [corps]) —
 * ce sont juste des tailles/directions calculées, aucune identité de sous-arbre à connaître.
 *
 * Le corps se fournit soit via `cells` (répartition égale — jamais plus de 2 colonnes, le dernier
 * élément d'un total impair prend toute la largeur de sa ligne), soit via `focus` (une carte
 * principale + le reste empilé à côté) — un seul des deux à la fois, `null` sur l'autre.
 */
@Component({
  selector: 'app-dashboard-layout-schema',
  imports: [IconComponent],
  templateUrl: './dashboard-layout-schema.component.html',
  styleUrl: './dashboard-layout-schema.component.css',
})
export class DashboardLayoutSchemaComponent {
  readonly menuPos = input<DashboardMenuPos>('left');
  readonly kpiPos = input<DashboardKpiPos>('top');
  readonly menuReduced = input(false);
  readonly kpiReduced = input(false);
  readonly cells = input<readonly DashboardLayoutSchemaCell[] | null>(null);
  readonly focus = input<DashboardLayoutSchemaFocus | null>(null);
  /** Côté des cartes secondaires en mode `focus` (voir `DashboardFocusSide`) — la carte principale
   * occupe l'AUTRE côté. Défaut `'right'` : reproduit l'ordre naturel du flex (`main` puis
   * `.dls-secondary`), `'left'` inverse via `flex-direction: row-reverse` (voir `focusDirection`). */
  readonly focusSide = input<'left' | 'right'>('right');
  /** Texte affiché quand `cells` est un tableau vide (aucune vue visible) — déjà traduit par
   * l'appelant, ce composant ne connaît pas l'i18n (même principe que `app-stepper.label`). */
  readonly emptyLabel = input('');

  /** Rend les cartes du corps déplaçables (glisser-déposer + flèches directionnelles au survol),
   * en plus de leur seule fonction d'aperçu — voir `DashboardLayoutPickerComponent`, section "Ordre
   * des blocs", qui réutilise ce MÊME composant (mêmes cellules `previewCells`/`previewFocus`,
   * même rendu visuel que l'aperçu figé du haut de page) plutôt qu'un second widget dupliqué. La
   * carte "mise en avant" (`focus().main`) n'est JAMAIS interactive, quelle que soit cette valeur :
   * son identité se choisit ailleurs (chips "Vue à mettre en avant"), pas ici — seules les cartes
   * secondaires/la grille égale peuvent s'échanger de place. */
  readonly interactive = input(false);
  /** Émis quand l'utilisateur relâche un glisser-déposer sur une autre carte, ou clique une flèche
   * directionnelle — `a`/`b` sont les `key` des deux cartes à permuter, dans l'ordre où ce composant
   * les a vues (pas d'ordre de préférence). Ce composant ne sait PAS ce que représentent ces clés
   * (pas de dépendance à `DashboardBodySlotKey`) : c'est à l'appelant de les interpréter (voir
   * `DashboardLayoutService.swapSlots`). */
  readonly swap = output<DashboardLayoutSchemaSwap>();

  /** Clé de la carte actuellement glissée (voir `dragstart`/`dragend`) — sert uniquement au style
   * (`.dragging`, opacité réduite pendant le glisser) ; le vrai transfert de données passe par
   * `DataTransfer` (`dragKey`), pas par ce champ, pour rester correct même si deux instances de ce
   * composant coexistaient (jamais le cas actuellement, mais pas d'hypothèse à faire ici). */
  protected draggingKey: string | null = null;

  protected onDragStart(event: DragEvent, key: string | undefined): void {
    if (!key) return;
    this.draggingKey = key;
    event.dataTransfer?.setData('text/plain', key);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }
  protected onDragEnd(): void {
    this.draggingKey = null;
  }
  protected onDrop(event: DragEvent, targetKey: string | undefined): void {
    event.preventDefault();
    const sourceKey = event.dataTransfer?.getData('text/plain');
    this.draggingKey = null;
    if (!sourceKey || !targetKey || sourceKey === targetKey) return;
    this.swap.emit({ a: sourceKey, b: targetKey });
  }

  /** Même garde que `onDrop`, pour les flèches directionnelles (voir template) — `key` peut être
   * `undefined` sur une carte non prévue pour l'interactivité (défensif, ne devrait pas arriver en
   * pratique : l'appelant ne pose `interactive` que sur des cellules qui fournissent toutes `key`). */
  protected emitSwap(a: string | undefined, b: string | undefined): void {
    if (!a || !b || a === b) return;
    this.swap.emit({ a, b });
  }

  /** Voisin dans la direction donnée pour une grille à 2 colonnes max (voir `.dls-equal`) — formule
   * purement géométrique (ligne/colonne à partir de l'index), y compris pour la dernière carte d'un
   * total impair qui occupe toute sa ligne (`span2`) : elle n'a ni gauche ni droite (rien de disposé
   * à côté d'elle dans sa propre ligne), et sa carte "au-dessus" retombe arbitrairement sur celle de
   * la colonne 0 plutôt que sur les deux — un choix pragmatique plutôt qu'une géométrie de grille
   * irrégulière à modéliser en toutes lettres, sans perte de portée : le glisser-déposer reste
   * disponible pour toute permutation directe à une seule étape, quelle que soit la géométrie. */
  protected gridNeighborIndex(
    i: number,
    dir: 'left' | 'right' | 'up' | 'down',
    total: number,
  ): number | null {
    const col = i % 2;
    const row = Math.floor(i / 2);
    if (dir === 'left') return col === 1 ? i - 1 : null;
    if (dir === 'right') return col === 0 && i + 1 < total ? i + 1 : null;
    if (dir === 'up') return row > 0 ? i - 2 : null;
    return i + 2 < total ? i + 2 : null; // 'down'
  }

  protected readonly menuVertical = computed(
    () => this.menuPos() === 'left' || this.menuPos() === 'right',
  );
  protected readonly frameDirection = computed(() =>
    this.menuPos() === 'right' ? 'row-reverse' : this.menuVertical() ? 'row' : 'column',
  );
  protected readonly menuAlign = computed(() =>
    this.menuPos() === 'top-right' ? 'flex-end' : 'flex-start',
  );
  protected readonly menuBasis = computed(() =>
    this.menuVertical() ? (this.menuReduced() ? 6 : 14) : this.menuReduced() ? 7 : 12,
  );

  protected readonly kpiVertical = computed(
    () => this.kpiPos() === 'left' || this.kpiPos() === 'right',
  );
  protected readonly afterDirection = computed(() =>
    this.kpiPos() === 'right'
      ? 'row-reverse'
      : this.kpiPos() === 'bottom'
        ? 'column-reverse'
        : this.kpiVertical()
          ? 'row'
          : 'column',
  );
  protected readonly kpiBasis = computed(() =>
    this.kpiVertical() ? (this.kpiReduced() ? 7 : 16) : this.kpiReduced() ? 6 : 12,
  );

  protected readonly focusDirection = computed(() =>
    this.focusSide() === 'left' ? 'row-reverse' : 'row',
  );

  protected readonly rows = computed(() => Math.ceil((this.cells()?.length ?? 1) / 2));
  protected readonly gridColumns = computed(() =>
    (this.cells()?.length ?? 0) === 1 ? '1fr' : '1fr 1fr',
  );
}
