import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';
import { LogFileAccessService } from './log-file-access.service';
import {
  ONBOARDING_CHAPTERS,
  ONBOARDING_SLIDES,
  OnboardingChapter,
  OnboardingChapterId,
  OnboardingSlide,
  OnboardingTrack,
} from '../data/onboarding-slides.data';

/** Local uniquement (pas une des données synchronisables, voir CLAUDE.md/`user-data.keys.ts`) :
 * un simple « déjà vu » côté navigateur, même famille que `wakfu-combat-panel-collapsed`. Suffixe
 * `-v2` : bascule du déclenchement automatique (voir plus bas, autrefois à la première connexion
 * réussie, désormais dès la page de setup) — un ancien flag posé sous l'ancien comportement ne
 * doit pas empêcher tout le monde de voir le nouveau déclenchement, plus précoce. */
const SEEN_KEY = 'wakfu-onboarding-seen-v2';
/** Dernier parcours choisi (Complet/Essentiel) — préférence locale, jamais synchronisée. */
const TRACK_KEY = 'wakfu-onboarding-track';

/**
 * État et déclenchement du pas-à-pas d'onboarding (diaporama de présentation des fonctionnalités).
 *
 * Deux parcours : « Complet » (toutes les diapositives) et « Essentiel » (celles marquées
 * `essential`, voir `onboarding-slides.data.ts`). `currentIndex` est un index dans le parcours
 * ACTIF (`slides()`), pas dans la liste complète : changer de parcours recale l'index sur la même
 * diapositive si elle existe dans le nouveau parcours, sinon sur la première.
 *
 * Deux façons de l'ouvrir :
 *  - automatiquement, une seule fois par navigateur, dès que la page de setup (sélection du
 *    fichier de log, voir `SetupComponent`) est atteinte — PAS besoin d'une connexion réussie
 *    (flag persistant `SEEN_KEY`, posé dès l'ouverture — pas seulement au bout du diaporama, pour
 *    ne jamais le rouvrir tout seul même si l'utilisateur ferme avant la fin) ;
 *  - manuellement, à tout moment (y compris depuis la page de setup elle-même, avant toute
 *    connexion — voir `AppHeaderComponent`), via le bouton d'aide de l'en-tête (voir
 *    `OnboardingHelpMenuComponent`), qui rejoue tout depuis le début ou saute à un chapitre.
 *
 * Injecté une fois au niveau racine (`app.ts`, même principe que `StatsStoreService`/`RouteSyncService`)
 * pour que l'effet de déclenchement automatique tourne dès le démarrage, indépendamment de tout
 * composant qui affiche effectivement le diaporama.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingTourService {
  private readonly persistence = inject(PersistenceService);
  private readonly logFileAccess = inject(LogFileAccessService);

  readonly chapters: readonly OnboardingChapter[] = ONBOARDING_CHAPTERS;

  readonly track = signal<OnboardingTrack>(
    this.persistence.getJson<OnboardingTrack>(TRACK_KEY) === 'essential' ? 'essential' : 'full',
  );

  /** Diapositives du parcours actif, dans l'ordre de présentation. */
  readonly slides = computed<readonly OnboardingSlide[]>(() =>
    this.track() === 'full' ? ONBOARDING_SLIDES : ONBOARDING_SLIDES.filter((s) => s.essential),
  );

  readonly isOpen = signal(false);
  readonly currentIndex = signal(0);

  readonly current = computed(() => this.slides()[this.currentIndex()]);
  readonly isFirst = computed(() => this.currentIndex() === 0);
  readonly isLast = computed(() => this.currentIndex() === this.slides().length - 1);

  /** Nombre de diapositives de chaque parcours (libellés du switch de parcours). */
  readonly fullCount = ONBOARDING_SLIDES.length;
  readonly essentialCount = ONBOARDING_SLIDES.filter((s) => s.essential).length;

  constructor() {
    effect(() => {
      // Même condition que app.html pour afficher <app-setup /> : dès que le fichier n'est pas
      // (encore) connecté, la page de setup est ce que l'utilisateur voit — inutile d'attendre une
      // connexion réussie, qui pouvait jusqu'ici retarder indéfiniment le pas-à-pas pour un
      // utilisateur qui hésite avant de connecter son fichier.
      if (this.logFileAccess.status() === 'connected') return;
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

  /** Ouvre le pas-à-pas sur la première diapositive d'un chapitre (menu « Aller directement
   * à… ») — dans le parcours Complet, le seul qui garantit que chaque chapitre a au moins une
   * diapositive. */
  openChapter(chapter: OnboardingChapterId): void {
    this.setTrack('full');
    this.openAt(this.slides().findIndex((s) => s.chapter === chapter));
  }

  close(): void {
    this.isOpen.set(false);
  }

  next(): void {
    if (this.isLast()) {
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

  /** « Passer au résumé » : saute à la dernière diapositive (celle qui rappelle où retrouver
   * l'aide) plutôt que de fermer. */
  goToEnd(): void {
    this.goTo(this.slides().length - 1);
  }

  setTrack(track: OnboardingTrack): void {
    if (track === this.track()) return;
    const current = this.current();
    this.track.set(track);
    this.persistence.setJson(TRACK_KEY, track);
    const kept = this.slides().indexOf(current);
    this.currentIndex.set(kept >= 0 ? kept : 0);
  }

  private clamp(index: number): number {
    return Math.max(0, Math.min(index, this.slides().length - 1));
  }
}
