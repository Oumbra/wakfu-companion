import { Injectable, effect, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';

export type ColorblindProfile = 'off' | 'redGreen' | 'tritanopia';

const COLORBLIND_KEY = 'wakfu-colorblind';

const PROFILES: readonly ColorblindProfile[] = ['off', 'redGreen', 'tritanopia'];

/** Anciennes valeurs stockées avant la fusion protanopie/deutéranopie en une seule option
 * `'redGreen'` (les deux profils appliquaient déjà exactement la même correction — même axe de
 * confusion rouge-vert, voir styles.css) : un utilisateur ayant choisi l'un ou l'autre avant ce
 * changement doit retrouver le même rendu, pas retomber sur `'off'`. */
const LEGACY_PROFILE_MIGRATION: Readonly<Record<string, ColorblindProfile>> = {
  protanopia: 'redGreen',
  deuteranopia: 'redGreen',
};

/**
 * Mode daltonien — préférence d'affichage locale (même principe que `ThemeService`/`I18nService` :
 * stockée via `PersistenceService`, pas synchronisée sur le compte — ce n'est pas une des six
 * données couvertes par `user-data.keys.ts`).
 *
 * Applique une classe `data-colorblind` sur `<html>`, lue par `styles.css` pour substituer les
 * paires de couleurs les plus sensibles (victoire/défaite, dégâts élémentaires...) par une palette
 * sûre pour le profil choisi. `'off'` retire l'attribut plutôt que de poser `data-colorblind="off"`
 * — plus simple à cibler en CSS (`:root[data-colorblind='redGreen']` etc., pas de règle "off").
 */
@Injectable({ providedIn: 'root' })
export class ColorblindService {
  readonly profile = signal<ColorblindProfile>('off');

  constructor(private readonly persistence: PersistenceService) {
    const stored = this.persistence.getJson<string>(COLORBLIND_KEY);
    if (stored && PROFILES.includes(stored as ColorblindProfile)) {
      this.profile.set(stored as ColorblindProfile);
    } else if (stored && LEGACY_PROFILE_MIGRATION[stored]) {
      this.profile.set(LEGACY_PROFILE_MIGRATION[stored]);
      this.persistence.setJson(COLORBLIND_KEY, LEGACY_PROFILE_MIGRATION[stored]);
    }

    effect(() => {
      const profile = this.profile();
      if (typeof document === 'undefined') return;
      if (profile === 'off') {
        delete document.documentElement.dataset['colorblind'];
      } else {
        document.documentElement.dataset['colorblind'] = profile;
      }
    });
  }

  setProfile(profile: ColorblindProfile): void {
    if (profile === this.profile()) return;
    this.profile.set(profile);
    this.persistence.setJson(COLORBLIND_KEY, profile);
  }
}
