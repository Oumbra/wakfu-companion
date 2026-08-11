import { Injectable, effect, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';

export type AppTheme = 'dark' | 'light';

const THEME_KEY = 'wakfu-theme';

/**
 * Thème clair/sombre — préférence d'affichage locale (comme `I18nService`
 * pour la locale), donc stockée directement via `PersistenceService` plutôt
 * que synchronisée sur le compte (voir `user-data.keys.ts`).
 *
 * Le thème système n'est détecté qu'une seule fois, à la toute première
 * visite (aucune valeur stockée) : une fois choisi (implicitement via le
 * système, ou explicitement via le switch), il se fige en préférence
 * persistée — ce n'est pas un mode "suit le système" qui resterait vivant en
 * continu (l'utilisateur qui bascule manuellement ne veut pas être ramené à
 * son thème système au prochain changement d'heure du jour, par exemple).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<AppTheme>('dark');

  constructor(private readonly persistence: PersistenceService) {
    const stored = this.persistence.getJson<AppTheme>(THEME_KEY);
    if (stored === 'dark' || stored === 'light') {
      this.theme.set(stored);
    } else if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: light)').matches
    ) {
      this.theme.set('light');
    }

    // Reflète le thème courant sur <html> à chaque changement — y compris la valeur initiale
    // ci-dessus, `effect()` s'exécute une première fois de façon synchrone au bootstrap.
    effect(() => {
      const theme = this.theme();
      if (typeof document !== 'undefined') {
        document.documentElement.dataset['theme'] = theme;
      }
    });
  }

  setTheme(theme: AppTheme): void {
    if (theme === this.theme()) return;
    this.theme.set(theme);
    this.persistence.setJson(THEME_KEY, theme);
  }
}
