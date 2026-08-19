import { effect, inject, Injectable, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';
import { LogFileAccessService } from './log-file-access.service';
import { ONBOARDING_SLIDES, OnboardingSlide } from '../data/onboarding-slides.data';

/** Local uniquement (pas une des 6 données synchronisables, voir CLAUDE.md/`user-data.keys.ts`) :
 * un simple « déjà vu » côté navigateur, même famille que `wakfu-combat-panel-collapsed`. */
const SEEN_KEY = 'wakfu-onboarding-seen';

/**
 * État et déclenchement du pas-à-pas d'onboarding (diaporama de présentation des fonctionnalités).
 *
 * Deux façons de l'ouvrir :
 *  - automatiquement, une seule fois, à la première connexion RÉUSSIE au fichier de log jamais vue
 *    par ce navigateur (flag persistant `SEEN_KEY`, posé dès l'ouverture — pas seulement au bout du
 *    diaporama, pour ne jamais le rouvrir tout seul même si l'utilisateur ferme avant la fin) ;
 *  - manuellement, à tout moment, via le bouton d'aide de l'en-tête (voir
 *    `OnboardingHelpMenuComponent`), qui rejoue tout depuis le début ou saute à une diapositive.
 *
 * Injecté une fois au niveau racine (`app.ts`, même principe que `StatsStoreService`/`RouteSyncService`)
 * pour que l'effet de déclenchement automatique tourne dès le démarrage, indépendamment de tout
 * composant qui affiche effectivement le diaporama.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingTourService {
  private readonly persistence = inject(PersistenceService);
  private readonly logFileAccess = inject(LogFileAccessService);

  readonly slides: readonly OnboardingSlide[] = ONBOARDING_SLIDES;

  readonly isOpen = signal(false);
  readonly currentIndex = signal(0);

  constructor() {
    effect(() => {
      if (this.logFileAccess.status() !== 'connected') return;
      if (this.persistence.getJson<boolean>(SEEN_KEY)) return;
      this.persistence.setJson(SEEN_KEY, true);
      this.openAt(0);
    });
  }

  /** Rejoue tout le pas-à-pas depuis le début (bouton d'aide). */
  open(): void {
    this.openAt(0);
  }

  openAt(index: number): void {
    this.currentIndex.set(this.clamp(index));
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  next(): void {
    if (this.currentIndex() >= this.slides.length - 1) {
      this.close();
      return;
    }
    this.currentIndex.update((i) => i + 1);
  }

  prev(): void {
    this.currentIndex.update((i) => Math.max(0, i - 1));
  }

  goTo(index: number): void {
    this.currentIndex.set(this.clamp(index));
  }

  private clamp(index: number): number {
    return Math.max(0, Math.min(index, this.slides.length - 1));
  }
}
