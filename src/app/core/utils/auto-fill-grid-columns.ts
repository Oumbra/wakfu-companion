import { signal } from '@angular/core';

/** Nombre de colonnes réellement rendues par une grille CSS `repeat(auto-fill, minmax(minCol,
 * 1fr))` — mêmes valeurs `gap`/`minCol` que la règle CSS correspondante (à garder synchronisées).
 * Utilisé pour savoir combien de tuiles composent la 1ère ligne (dont le tooltip doit s'afficher
 * en dessous plutôt qu'au-dessus, sinon rogné par le panneau). */
export function computeAutoFillColumns(el: HTMLElement, gap: number, minCol: number): number {
  const style = getComputedStyle(el);
  const contentWidth =
    el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return Math.max(1, Math.floor((contentWidth + gap) / (minCol + gap)));
}

/**
 * Recalcule `columns` à chaque redimensionnement de l'élément observé via `ResizeObserver` — une
 * simple lecture ponctuelle de taille dans un `effect()` juste après qu'un `viewChild` se résout
 * peut renvoyer une taille transitoire, pas la taille finale (voir CLAUDE.md) ; le `ResizeObserver`
 * se redéclenche automatiquement une fois la taille réelle atteinte et corrige la valeur.
 *
 * Usage : instancier en champ de composant, appeler `observe(el)` dans un `effect()` qui lit le
 * `viewChild` de l'élément grille, et `disconnect()` dans `ngOnDestroy`.
 */
export class AutoFillColumnsObserver {
  readonly columns = signal(1);
  private resizeObserver?: ResizeObserver;

  constructor(
    private readonly gap: number,
    private readonly minCol: number,
  ) {}

  observe(el: HTMLElement | undefined): void {
    this.resizeObserver?.disconnect();
    if (!el) return;
    this.resizeObserver = new ResizeObserver(() => this.update(el));
    this.resizeObserver.observe(el);
    this.update(el);
  }

  disconnect(): void {
    this.resizeObserver?.disconnect();
  }

  private update(el: HTMLElement): void {
    this.columns.set(computeAutoFillColumns(el, this.gap, this.minCol));
  }
}
