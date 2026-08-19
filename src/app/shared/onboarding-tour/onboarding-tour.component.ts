import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { OnboardingTourService } from '../../core/services/onboarding-tour.service';
import { TranslatePipe } from '../translate.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';
import { OnboardingIconComponent } from '../onboarding-icon/onboarding-icon.component';

/**
 * Diaporama d'onboarding (pas-à-pas des fonctionnalités) — rendu une seule fois au niveau racine
 * (voir app.html, même principe que `HelpModalComponent`). État entièrement piloté par
 * `OnboardingTourService` : ce composant ne fait que l'afficher.
 *
 * Fermeture volontairement au clic uniquement (voir template) : ni le fond, ni Échap, ni le bouton
 * × en haut à droite ne ferment la modale — seul le bouton primaire de la dernière diapositive
 * (« Commencer à jouer ») le fait, pour garantir que le pas-à-pas soit vu jusqu'au bout. Le × sert à
 * sauter directement à cette dernière diapositive plutôt qu'à fermer.
 */
@Component({
  selector: 'app-onboarding-tour',
  imports: [TranslatePipe, TooltipDirective, OnboardingIconComponent],
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

  /** Vrai une fois le média (GIF potentiellement volumineux, non recompressé) entièrement chargé —
   * tant que c'est faux, l'aperçu statique (`poster`) reste affiché par-dessus (fondu enchaîné, voir
   * le CSS) plutôt que de laisser un cadre vide le temps du téléchargement. */
  protected readonly mediaLoaded = signal(false);

  private readonly modal = viewChild<ElementRef<HTMLDivElement>>('modal');

  constructor() {
    // Pose le focus sur la modale à chaque ouverture (y compris un saut direct depuis le menu
    // d'aide) pour que les flèches clavier fonctionnent immédiatement, sans clic préalable — même
    // principe que ConfirmDeletePopoverComponent.
    effect(() => {
      if (this.tour.isOpen()) this.modal()?.nativeElement.focus();
    });

    // Réarme le fondu média à chaque changement de diapositive (précédent/suivant, puce, saut direct
    // depuis le menu d'aide) — sans ça, le média resterait affiché "chargé" pour la diapositive
    // suivante avant que son propre `(load)` n'ait eu l'occasion de se déclencher.
    effect(() => {
      this.slide();
      this.mediaLoaded.set(false);
    });
  }

  /** Flèches gauche/droite pour naviguer, en plus des boutons et des puces — même convention que
   * `app-stepper`/`app-input-number` (voir CLAUDE.md). Pas de gestion d'Échap ici : la fermeture au
   * clavier est volontairement désactivée (voir la doc de classe). */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.tour.prev();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.tour.next();
    }
  }

  /** Bouton × en haut à droite : saute à la dernière diapositive plutôt que de fermer. */
  protected jumpToEnd(): void {
    this.tour.goTo(this.total - 1);
  }
}
