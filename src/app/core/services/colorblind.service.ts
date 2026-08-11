import { Injectable, effect, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';

export type ColorblindProfile = 'off' | 'protanopia' | 'deuteranopia' | 'tritanopia';

const COLORBLIND_KEY = 'wakfu-colorblind';

const PROFILES: readonly ColorblindProfile[] = ['off', 'protanopia', 'deuteranopia', 'tritanopia'];

/**
 * Mode daltonien — préférence d'affichage locale (même principe que `ThemeService`/`I18nService` :
 * stockée via `PersistenceService`, pas synchronisée sur le compte — ce n'est pas une des six
 * données couvertes par `user-data.keys.ts`).
 *
 * Applique une classe `data-colorblind` sur `<html>`, lue par `styles.css` pour substituer les
 * paires de couleurs les plus sensibles (victoire/défaite, dégâts élémentaires...) par une palette
 * sûre pour le profil choisi. `'off'` retire l'attribut plutôt que de poser `data-colorblind="off"`
 * — plus simple à cibler en CSS (`:root[data-colorblind='protanopia']` etc., pas de règle "off").
 */
@Injectable({ providedIn: 'root' })
export class ColorblindService {
  readonly profile = signal<ColorblindProfile>('off');

  constructor(private readonly persistence: PersistenceService) {
    const stored = this.persistence.getJson<ColorblindProfile>(COLORBLIND_KEY);
    if (stored && PROFILES.includes(stored)) {
      this.profile.set(stored);
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
