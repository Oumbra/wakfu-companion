import { OnboardingIconName } from '../../shared/onboarding-icon/onboarding-icon.component';

/** Illustration animée d'une diapositive — vidéo courte (mp4, sans son, en boucle) recadrée à
 * partir d'un extrait réel de la fonctionnalité, avec une image `poster` (1ʳᵉ frame) affichée avant
 * que la vidéo ne soit chargée. `null` pour les 2 diapositives de bord (bienvenue/fin), qui n'ont
 * qu'une grande icône plutôt qu'une démonstration. */
export interface OnboardingSlideMedia {
  readonly video: string;
  readonly poster: string;
}

export interface OnboardingSlide {
  readonly id: string;
  readonly icon: OnboardingIconName;
  readonly media: OnboardingSlideMedia | null;
  readonly titleKey: string;
  readonly descKey: string;
  /** Libellé court pour le menu « Aller directement à… » du bouton d'aide (voir
   * OnboardingHelpMenuComponent) — distinct du titre (accrocheur, une phrase) de la diapositive
   * elle-même. `null` pour les 2 diapositives de bord, absentes de ce menu (sauter directement à une
   * intro/outro n'a pas de sens). */
  readonly labelKey: string | null;
}

/** Les 9 diapositives du pas-à-pas d'onboarding, dans l'ordre de présentation — voir
 * OnboardingTourService (état/déclenchement) et OnboardingTourComponent (rendu). Chaque
 * titre/description vit dans `translations.ts` sous la clé `onboarding.<id>.*` (4 locales). */
export const ONBOARDING_SLIDES: readonly OnboardingSlide[] = [
  {
    id: 'welcome',
    icon: 'logo',
    media: null,
    titleKey: 'onboarding.welcome.title',
    descKey: 'onboarding.welcome.desc',
    labelKey: null,
  },
  {
    id: 'tracker',
    icon: 'trending-up',
    media: {
      video: 'assets/onboarding/tracker.mp4',
      poster: 'assets/onboarding/tracker-poster.jpg',
    },
    titleKey: 'onboarding.tracker.title',
    descKey: 'onboarding.tracker.desc',
    labelKey: 'onboarding.tracker.label',
  },
  {
    id: 'damage',
    icon: 'swords',
    media: { video: 'assets/onboarding/fight.mp4', poster: 'assets/onboarding/fight-poster.jpg' },
    titleKey: 'onboarding.damage.title',
    descKey: 'onboarding.damage.desc',
    labelKey: 'onboarding.damage.label',
  },
  {
    id: 'history',
    icon: 'clock-long',
    media: {
      video: 'assets/onboarding/historics.mp4',
      poster: 'assets/onboarding/historics-poster.jpg',
    },
    titleKey: 'onboarding.history.title',
    descKey: 'onboarding.history.desc',
    labelKey: 'onboarding.history.label',
  },
  {
    id: 'chat',
    icon: 'chat-bubble',
    media: { video: 'assets/onboarding/chat.mp4', poster: 'assets/onboarding/chat-poster.jpg' },
    titleKey: 'onboarding.chat.title',
    descKey: 'onboarding.chat.desc',
    labelKey: 'onboarding.chat.label',
  },
  {
    id: 'watchlist',
    icon: 'volume-on',
    media: {
      video: 'assets/onboarding/tracker-alert.mp4',
      poster: 'assets/onboarding/tracker-alert-poster.jpg',
    },
    titleKey: 'onboarding.watchlist.title',
    descKey: 'onboarding.watchlist.desc',
    labelKey: 'onboarding.watchlist.label',
  },
  {
    id: 'sessionRecap',
    icon: 'calendar',
    media: {
      video: 'assets/onboarding/session-recap.mp4',
      poster: 'assets/onboarding/session-recap-poster.jpg',
    },
    titleKey: 'onboarding.sessionRecap.title',
    descKey: 'onboarding.sessionRecap.desc',
    labelKey: 'onboarding.sessionRecap.label',
  },
  {
    id: 'profile',
    icon: 'person',
    media: {
      video: 'assets/onboarding/profile.mp4',
      poster: 'assets/onboarding/profile-poster.jpg',
    },
    titleKey: 'onboarding.profile.title',
    descKey: 'onboarding.profile.desc',
    labelKey: 'onboarding.profile.label',
  },
  {
    id: 'done',
    icon: 'check',
    media: null,
    titleKey: 'onboarding.done.title',
    descKey: 'onboarding.done.desc',
    labelKey: null,
  },
];

/** Diapositives proposées par le menu « Aller directement à… » du bouton d'aide — les 2 diapositives
 * de bord (bienvenue/fin) en sont volontairement exclues, voir `labelKey`. */
export const ONBOARDING_JUMP_SLIDES: readonly OnboardingSlide[] = ONBOARDING_SLIDES.filter(
  (slide) => slide.labelKey !== null,
);
