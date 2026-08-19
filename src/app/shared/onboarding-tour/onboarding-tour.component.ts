import { Component, computed, effect, ElementRef, inject, viewChild } from '@angular/core';
import { OnboardingTourService } from '../../core/services/onboarding-tour.service';
import { TranslatePipe } from '../translate.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';
import { EscapeCloseDirective } from '../escape-close.directive';
import { OnboardingIconComponent } from '../onboarding-icon/onboarding-icon.component';

/**
 * Diaporama d'onboarding (pas-à-pas des fonctionnalités) — rendu une seule fois au niveau racine
 * (voir app.html, même principe que `HelpModalComponent`). État entièrement piloté par
 * `OnboardingTourService` : ce composant ne fait que l'afficher.
 *
 * Chaque diapositive avec démo (toutes sauf bienvenue/fin) illustre la fonctionnalité par un extrait
 * vidéo court (silencieux, en boucle) plutôt qu'une capture statique — voir `OnboardingSlideMedia`.
 */
@Component({
  selector: 'app-onboarding-tour',
  imports: [TranslatePipe, TooltipDirective, EscapeCloseDirective, OnboardingIconComponent],
  templateUrl: './onboarding-tour.component.html',
  styleUrl: './onboarding-tour.component.css',
})
export class OnboardingTourComponent {
  protected readonly tour = inject(OnboardingTourService);

  protected readonly slide = computed(() => this.tour.slides[this.tour.currentIndex()]);
  protected readonly total = this.tour.slides.length;
  protected readonly isFirst = computed(() => this.tour.currentIndex() === 0);
  protected readonly isLast = computed(() => this.tour.currentIndex() === this.total - 1);
  protected readonly dotIndexes = this.tour.slides.map((_, i) => i);

  private readonly modal = viewChild<ElementRef<HTMLDivElement>>('modal');

  constructor() {
    // Pose le focus sur la modale à chaque ouverture (y compris un saut direct depuis le menu
    // d'aide) pour que les flèches clavier fonctionnent immédiatement, sans clic préalable — même
    // principe que ConfirmDeletePopoverComponent.
    effect(() => {
      if (this.tour.isOpen()) this.modal()?.nativeElement.focus();
    });
  }

  /** Flèches gauche/droite pour naviguer, en plus des boutons et des puces — même convention que
   * `app-stepper`/`app-input-number` (voir CLAUDE.md). Échap est géré séparément par
   * `EscapeCloseDirective` sur le fond. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.tour.prev();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.tour.next();
    }
  }
}
