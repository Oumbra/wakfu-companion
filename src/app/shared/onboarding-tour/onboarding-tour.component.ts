import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { OnboardingTourService } from '../../core/services/onboarding-tour.service';
import {
  ONBOARDING_SLIDES,
  OnboardingChapter,
  OnboardingChapterId,
  OnboardingImage,
  OnboardingSlide,
  OnboardingText,
} from '../../core/data/onboarding-slides.data';
import { TranslatePipe } from '../translate.pipe';
import { TranslateHtmlPipe } from '../translate-html.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';
import { OnboardingIconComponent } from '../onboarding-icon/onboarding-icon.component';

/** Chapitre tel qu'affiché dans le sommaire : ses diapositives du parcours actif, avec leur index
 * dans ce parcours (pour `goTo`). */
interface TocChapter {
  readonly chapter: OnboardingChapter;
  readonly items: readonly { readonly slide: OnboardingSlide; readonly index: number }[];
}

/** Groupe de puces du pied de page : une par chapitre, plus les 2 diapositives de bord. */
interface DotGroup {
  readonly key: string;
  readonly indexes: readonly number[];
}

/**
 * Diaporama d'onboarding (pas-à-pas des fonctionnalités) — rendu une seule fois au niveau racine
 * (voir app.html, même principe que `HelpModalComponent`). État entièrement piloté par
 * `OnboardingTourService` : ce composant ne fait que l'afficher.
 *
 * Structure : sommaire des chapitres à gauche (bandeau de puces en mobile), diapositive au centre
 * composée de blocs typés (voir `onboarding-slides.data.ts`), pied de page avec progression.
 * Cliquer une capture l'agrandit dans une visionneuse interne à la modale (Échap ou clic pour
 * revenir).
 *
 * Fermeture volontairement au clic uniquement : ni le fond ni Échap ne ferment la modale — seul le
 * bouton primaire de la dernière diapositive (« Commencer à jouer ») le fait. « Passer au résumé »
 * saute à cette dernière diapositive plutôt que de fermer, pour que le rappel « où retrouver
 * l'aide » soit toujours vu.
 */
@Component({
  selector: 'app-onboarding-tour',
  imports: [
    NgTemplateOutlet,
    TranslatePipe,
    TranslateHtmlPipe,
    TooltipDirective,
    OnboardingIconComponent,
  ],
  templateUrl: './onboarding-tour.component.html',
  styleUrl: './onboarding-tour.component.css',
})
export class OnboardingTourComponent {
  protected readonly tour = inject(OnboardingTourService);

  protected readonly slide = this.tour.current;
  protected readonly total = computed(() => this.tour.slides().length);

  protected readonly chapterIndex = computed(() =>
    this.tour.chapters.findIndex((c) => c.id === this.slide().chapter),
  );
  protected readonly chapter = computed(() => this.tour.chapters[this.chapterIndex()] ?? null);

  protected readonly toc = computed<readonly TocChapter[]>(() => {
    const slides = this.tour.slides();
    return this.tour.chapters
      .map((chapter) => ({
        chapter,
        items: slides
          .map((slide, index) => ({ slide, index }))
          .filter(({ slide }) => slide.chapter === chapter.id),
      }))
      .filter((c) => c.items.length > 0);
  });

  protected readonly dotGroups = computed<readonly DotGroup[]>(() => {
    const slides = this.tour.slides();
    const groups: DotGroup[] = [];
    slides.forEach((slide, index) => {
      const key = slide.chapter ?? slide.id;
      const last = groups[groups.length - 1];
      if (last && last.key === key)
        groups[groups.length - 1] = { key, indexes: [...last.indexes, index] };
      else groups.push({ key, indexes: [index] });
    });
    return groups;
  });

  protected readonly progressPercent = computed(() =>
    this.total() > 1 ? (this.tour.currentIndex() / (this.total() - 1)) * 100 : 100,
  );

  /** Nombre de diapositives de chaque chapitre dans le parcours Complet (cartes de la diapositive
   * d'accueil — le saut par chapitre ouvre toujours le parcours Complet, voir `openChapter`). */
  protected readonly chapterSizes: Readonly<Record<OnboardingChapterId, number>> =
    Object.fromEntries(
      this.tour.chapters.map((c) => [
        c.id,
        ONBOARDING_SLIDES.filter((s) => s.chapter === c.id).length,
      ]),
    ) as Record<OnboardingChapterId, number>;

  /** Capture agrandie dans la visionneuse (`null` = fermée). */
  protected readonly zoomed = signal<OnboardingImage | null>(null);

  private readonly modal = viewChild<ElementRef<HTMLDivElement>>('modal');
  private readonly slideEl = viewChild<ElementRef<HTMLElement>>('slideEl');

  constructor() {
    // Pose le focus sur la modale à chaque ouverture (y compris un saut direct depuis le menu
    // d'aide) pour que les flèches clavier fonctionnent immédiatement, sans clic préalable — même
    // principe que ConfirmDeletePopoverComponent.
    effect(() => {
      if (this.tour.isOpen()) this.modal()?.nativeElement.focus();
    });

    // Chaque diapositive repart de son haut, et la visionneuse se referme.
    effect(() => {
      this.slide();
      this.zoomed.set(null);
      const el = this.slideEl()?.nativeElement;
      if (el) el.scrollTop = 0;
    });
  }

  /** Flèches gauche/droite pour naviguer, Échap pour refermer la visionneuse — même convention
   * que `app-stepper`/`app-input-number`. Échap ne ferme PAS la modale (voir la doc de classe). */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.zoomed()) {
      event.preventDefault();
      this.zoomed.set(null);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.tour.prev();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.tour.next();
    }
  }

  protected goToChapter(id: OnboardingChapterId): void {
    const index = this.tour.slides().findIndex((s) => s.chapter === id);
    if (index >= 0) this.tour.goTo(index);
    else this.tour.openChapter(id);
  }

  protected hasBadges(lines: readonly OnboardingText[]): boolean {
    return lines.some((l) => l.badge !== undefined);
  }

  /** Style de la loupe : même image en fond, agrandie et centrée sur le point visé. */
  protected lensStyle(image: OnboardingImage): Record<string, string> {
    const lens = image.lens!;
    return {
      'background-image': `url(${image.src})`,
      'background-size': `${lens.scale * 100}% auto`,
      'background-position': `${lens.x * 100}% ${lens.y * 100}%`,
    };
  }
}
