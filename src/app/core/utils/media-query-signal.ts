import { signal } from '@angular/core';

/**
 * Signal réactif reflétant l'état courant d'une media query CSS — utile quand du code TS a besoin
 * de brancher sur le même seuil qu'une règle `@media` pure (ex. le seuil mobile 800px, voir
 * `.mobile-only`/`.desktop-only` dans styles.css et `@media (max-width: 800px)` un peu partout côté
 * composants), pas seulement un `display: none/flex`. Mêmes conventions que
 * `AutoFillColumnsObserver` (core/utils/auto-fill-grid-columns.ts) : instancier en champ de
 * composant, `disconnect()` dans `ngOnDestroy`.
 */
export class MediaQuerySignal {
  private readonly mql: MediaQueryList | null;
  readonly matches;
  private readonly handler = (event: MediaQueryListEvent) => this.matches.set(event.matches);

  constructor(query: string) {
    // `window` absent en SSR/tests sans DOM — `matches` reste alors figé à sa valeur par défaut.
    this.mql = typeof window !== 'undefined' ? window.matchMedia(query) : null;
    this.matches = signal(this.mql?.matches ?? false);
    this.mql?.addEventListener('change', this.handler);
  }

  disconnect(): void {
    this.mql?.removeEventListener('change', this.handler);
  }
}
