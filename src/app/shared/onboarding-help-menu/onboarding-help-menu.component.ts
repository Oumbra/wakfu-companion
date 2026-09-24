import { Component, inject } from '@angular/core';
import { OnboardingHelpMenuService } from '../../core/services/onboarding-help-menu.service';
import { OnboardingTourService } from '../../core/services/onboarding-tour.service';
import { OnboardingChapterId } from '../../core/data/onboarding-slides.data';
import { TranslatePipe } from '../translate.pipe';
import { EscapeCloseDirective } from '../escape-close.directive';
import { OnboardingIconComponent } from '../onboarding-icon/onboarding-icon.component';

/**
 * Popover du bouton d'aide de l'en-tête (« ? ») : revoir tout le pas-à-pas depuis le début, ou
 * sauter directement à un chapitre — rendue une seule fois au niveau racine (voir app.html),
 * pilotée par `OnboardingHelpMenuService`. Ouvre/fait sauter le diaporama via `OnboardingTourService`.
 */
@Component({
  selector: 'app-onboarding-help-menu',
  imports: [TranslatePipe, EscapeCloseDirective, OnboardingIconComponent],
  templateUrl: './onboarding-help-menu.component.html',
  styleUrl: './onboarding-help-menu.component.css',
})
export class OnboardingHelpMenuComponent {
  protected readonly helpMenu = inject(OnboardingHelpMenuService);
  protected readonly tour = inject(OnboardingTourService);

  protected replayAll(): void {
    this.tour.open();
    this.helpMenu.close();
  }

  protected jumpTo(chapter: OnboardingChapterId): void {
    this.tour.openChapter(chapter);
    this.helpMenu.close();
  }
}
