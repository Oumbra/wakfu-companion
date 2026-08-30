import { Component, inject } from '@angular/core';
import { LoadingOverlayService } from '../../core/services/loading-overlay.service';
import { TranslatePipe } from '../translate.pipe';

/**
 * Overlay de chargement plein écran (fond opaque + spinner de la couleur `--accent`), rendu une
 * seule fois au niveau racine (`app.html`, comme `<app-tooltip />`/`<app-class-picker />`) et
 * piloté par `LoadingOverlayService.visible` — jamais dupliqué localement par appelant (voir
 * convention "Toujours un composant, jamais un bloc recopié" dans CLAUDE.md). Bloque toute
 * interaction avec le reste de l'app tant qu'il est affiché (voir CSS, `pointer-events: auto`).
 */
@Component({
  selector: 'app-loading-overlay',
  imports: [TranslatePipe],
  templateUrl: './loading-overlay.component.html',
  styleUrl: './loading-overlay.component.css',
})
export class LoadingOverlayComponent {
  protected readonly loadingOverlay = inject(LoadingOverlayService);
}
