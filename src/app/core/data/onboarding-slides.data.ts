import { OnboardingIconName } from '../../shared/onboarding-icon/onboarding-icon.component';

/** Illustration animée d'une diapositive — GIF ou vidéo (mp4, sans son, en boucle), avec une image
 * `poster` (aperçu statique) affichée en attendant que le fichier réel (potentiellement volumineux
 * pour un GIF non recompressé) finisse de charger — voir OnboardingTourComponent, qui fait un
 * fondu enchaîné entre les deux. `null` pour les 2 diapositives de bord (bienvenue/fin), qui n'ont
 * qu'une grande icône plutôt qu'une démonstration. */
export interface OnboardingSlideMedia {
  readonly kind: 'gif' | 'video';
  readonly src: string;
  readonly poster: string;
}

export interface OnboardingSlide {
  readonly id: string;
  readonly icon: OnboardingIconName;
  readonly media: OnboardingSlideMedia | null;
  /** Position de l'illustration par rapport au texte — `'side'` (défaut) pour le gabarit standard,
   * `'top'` pour les rares illustrations trop larges/plates pour la colonne latérale (ex.
   * `watchlist`, dont le GIF d'origine est un bandeau ~4,7:1 — voir OnboardingTourComponent). */
  readonly mediaPosition?: 'side' | 'top';
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
    mediaPosition: 'top',
    titleKey: 'onboarding.welcome.title',
    descKey: 'onboarding.welcome.desc',
    labelKey: null,
  },
  {
    id: 'tracker',
    icon: 'trending-up',
    media: {
      kind: 'gif',
      src: 'assets/onboarding/tracker.gif',
      poster: 'assets/onboarding/tracker-poster.jpg',
    },
    titleKey: 'onboarding.tracker.title',
    descKey: 'onboarding.tracker.desc',
    labelKey: 'onboarding.tracker.label',
  },
  {
    id: 'damage',
    icon: 'swords',
    media: {
      kind: 'gif',
      src: 'assets/onboarding/fight.gif',
      poster: 'assets/onboarding/fight-poster.jpg',
    },
    titleKey: 'onboarding.damage.title',
    descKey: 'onboarding.damage.desc',
    labelKey: 'onboarding.damage.label',
  },
  {
    id: 'history',
    icon: 'clock-long',
    media: {
      kind: 'gif',
      src: 'assets/onboarding/historics.gif',
      poster: 'assets/onboarding/historics-poster.jpg',
    },
    titleKey: 'onboarding.history.title',
    descKey: 'onboarding.history.desc',
    labelKey: 'onboarding.history.label',
  },
  {
    id: 'chat',
    icon: 'chat-bubble',
    media: {
      kind: 'gif',
      src: 'assets/onboarding/chat.gif',
      poster: 'assets/onboarding/chat-poster.jpg',
    },
    titleKey: 'onboarding.chat.title',
    descKey: 'onboarding.chat.desc',
    labelKey: 'onboarding.chat.label',
  },
  {
    id: 'watchlist',
    icon: 'volume-on',
    // Illustration au-dessus du texte plutôt qu'à côté (mediaPosition 'top') : le GIF d'origine est
    // un bandeau très large et plat (~4,7:1), qui se retrouverait noyé dans le padding de la colonne
    // latérale standard (trop haute et étroite pour ce format) — voir CLAUDE.md/retour utilisateur.
    mediaPosition: 'top',
    media: {
      kind: 'gif',
      src: 'assets/onboarding/tracker-alert.gif',
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
      kind: 'gif',
      src: 'assets/onboarding/session-recap.gif',
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
      kind: 'gif',
      src: 'assets/onboarding/profile.gif',
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
    mediaPosition: 'top',
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
