import { Component, input } from '@angular/core';
import { AppIconName, IconComponent } from '../icon/icon.component';
import {
  APP_LOGO_PURPLE_DATA_URI,
  LARGE_APP_LOGO_PURPLE_DATA_URI,
} from '../../core/data/app-logo.data';

/** Icônes utilisables par une diapositive d'onboarding : soit un nom du sprite partagé
 * (`AppIconName`), soit le logo de l'app, soit l'un des 2 pictogrammes propres à l'onboarding
 * (aucune fonctionnalité existante n'en avait besoin avant, donc absents du sprite — dessinés ici
 * dans le même style que celui-ci : grille 24px, trait 1.8, extrémités arrondies). */
export type OnboardingIconName = AppIconName | 'logo' | 'chat-bubble' | 'person';

const APP_ICON_NAMES = new Set<OnboardingIconName>([
  'clock',
  'clock-long',
  'reset',
  'check',
  'chevron-left',
  'edit',
  'volume-on',
  'volume-off',
  'calendar',
  'map-pin',
  'swords',
  'trending-up',
  'target',
]);

/** Icône d'une diapositive d'onboarding — utilisée à la fois dans la diapositive elle-même
 * (`OnboardingTourComponent`) et dans le menu « Aller directement à… » du bouton d'aide
 * (`OnboardingHelpMenuComponent`), d'où l'extraction en composant partagé plutôt qu'un `@if`/`@else`
 * dupliqué aux deux endroits (voir CLAUDE.md, principe de réutilisation des composants). Le logo a
 * son propre rendu (`<img>`, pas une icône vectorielle) : le composant l'assume directement plutôt
 * que de renvoyer la responsabilité à l'appelant.
 */
@Component({
  selector: 'app-onboarding-icon',
  imports: [IconComponent],
  templateUrl: './onboarding-icon.component.html',
  styleUrl: './onboarding-icon.component.css',
})
export class OnboardingIconComponent {
  readonly name = input.required<OnboardingIconName>();
  readonly size = input(20);
  readonly strokeWidth = input(1.8);

  protected readonly appLogo = LARGE_APP_LOGO_PURPLE_DATA_URI;

  protected isAppIcon(name: OnboardingIconName): boolean {
    return APP_ICON_NAMES.has(name);
  }
}
