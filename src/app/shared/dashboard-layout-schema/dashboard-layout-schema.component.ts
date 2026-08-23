import { Component, computed, input } from '@angular/core';

export type DashboardMenuPos = 'left' | 'right' | 'top-left' | 'top-right';
export type DashboardKpiPos = 'top' | 'bottom' | 'left' | 'right';

/** Une "carte" schématisée du corps — la couleur seule suffit à l'identifier (voir légende dans
 * `DashboardLayoutPickerComponent`), aucun texte n'est rendu dedans : ce composant est purement
 * décoratif/structurel, jamais responsable de la traduction des libellés. */
export interface DashboardLayoutSchemaCell {
  readonly sw: 'history' | 'chat';
  /** Dernière carte d'une répartition à nombre impair : occupe toute la largeur de sa ligne (voir
   * `DashboardLayoutPickerComponent.previewCells`, même règle que la grille réelle envisagée). */
  readonly span2?: boolean;
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
