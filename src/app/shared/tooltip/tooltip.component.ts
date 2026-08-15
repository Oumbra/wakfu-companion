import { Component, computed, inject } from '@angular/core';
import { TooltipPosition, TooltipService } from '../../core/services/tooltip.service';

const GAP = 6;

interface TooltipStyle {
  left: number;
  top: number;
  transform: string;
}

/** Calcule la position CSS `fixed` du tooltip à partir du rect de l'élément
 * cible et de l'emplacement demandé — voir `TooltipService` pour le pourquoi
 * du `position: fixed` calculé plutôt qu'un `position: absolute` en flux. */
function computeStyle(rect: DOMRect, position: TooltipPosition): TooltipStyle {
  switch (position) {
    case 'top':
      return {
        left: rect.left + rect.width / 2,
        top: rect.top - GAP,
        transform: 'translate(-50%, -100%)',
      };
    case 'top-left':
      return { left: rect.left, top: rect.top - GAP, transform: 'translateY(-100%)' };
    case 'top-right':
      return { left: rect.right, top: rect.top - GAP, transform: 'translate(-100%, -100%)' };
    case 'bottom':
      return {
        left: rect.left + rect.width / 2,
        top: rect.bottom + GAP,
        transform: 'translateX(-50%)',
      };
    case 'bottom-left':
      return { left: rect.left, top: rect.bottom + GAP, transform: 'none' };
    case 'bottom-right':
      return { left: rect.right, top: rect.bottom + GAP, transform: 'translateX(-100%)' };
    case 'left':
      return {
        left: rect.left - GAP,
        top: rect.top + rect.height / 2,
        transform: 'translate(-100%, -50%)',
      };
    case 'right':
      return {
        left: rect.right + GAP,
        top: rect.top + rect.height / 2,
        transform: 'translateY(-50%)',
      };
  }
}

/**
 * Tooltip générique de l'app, rendu une seule fois au niveau racine
 * (`app.html`). Ne rien mettre d'autre ici : tout le contenu vient de
 * `TooltipService.request()`, piloté par `TooltipDirective` sur l'élément
 * survolé/focus. Voir `TooltipService` pour le raisonnement `position: fixed`.
 */
@Component({
  selector: 'app-tooltip',
  templateUrl: './tooltip.component.html',
  styleUrl: './tooltip.component.css',
})
export class TooltipComponent {
  private readonly tooltipService = inject(TooltipService);

  protected readonly request = this.tooltipService.request;

  protected readonly style = computed<TooltipStyle | null>(() => {
    const req = this.request();
    return req ? computeStyle(req.rect, req.position) : null;
  });
}
