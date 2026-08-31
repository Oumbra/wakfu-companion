import { Injectable, signal } from '@angular/core';
import { LoadMoreSpan } from '../sync/history-event.model';

export interface LoadMoreScopeMenuRequest {
  /** Distance depuis le BAS du viewport jusqu'au HAUT du bouton ayant ouvert le menu (marge
   * comprise) — posée en CSS via `bottom`, jamais `top` : le bouton "Charger plus" est toujours en
   * pied de panneau (voir `history.component.html`), le menu s'ouvre donc systématiquement vers le
   * HAUT ("dropup"), au-dessus du bouton plutôt qu'en dessous où il n'y a jamais de place. */
  bottom: number;
  left: number;
  onChoose: (span: LoadMoreSpan) => void;
}

/**
 * Petit menu (semaine/mois/année, voir `LoadMoreSpan`) pour choisir la portée temporelle du
 * "Charger plus" de l'historique (voir `HistoryArchiveService.loadMoreForSpan`) — rendu une seule
 * fois au niveau racine (`app.html`), même principe que `ClassPickerService`/`TooltipService`/
 * `OnboardingHelpMenuService` (voir CLAUDE.md, "Réutiliser ce service pour tout futur menu
 * contextuel `position: fixed`") : le bouton qui l'ouvre vit dans un `.tool-panel` (`overflow:
 * hidden`), un menu rendu localement en `position: absolute` y serait rogné dès qu'il dépasse le
 * panneau — un rendu à part en `position: fixed` échappe entièrement à cette contrainte.
 */
@Injectable({ providedIn: 'root' })
export class LoadMoreScopeMenuService {
  readonly request = signal<LoadMoreScopeMenuRequest | null>(null);

  /** `anchor` : le bouton cliqué (voir `event.currentTarget` côté appelant), utilisé uniquement
   * pour calculer la position d'ouverture — jamais mémorisé au-delà. */
  open(anchor: HTMLElement, onChoose: (span: LoadMoreSpan) => void): void {
    const rect = anchor.getBoundingClientRect();
    const margin = 6;
    this.request.set({
      bottom: window.innerHeight - rect.top + margin,
      left: rect.left,
      onChoose,
    });
  }

  close(): void {
    this.request.set(null);
  }
}
