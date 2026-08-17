import { Injectable, effect, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';

export type AppTheme = 'dark' | 'light';

/** Une variante par palette claire proposée (voir styles.css, blocs `[data-theme='light']
 * [data-light-theme='...']`) — sans effet tant que `theme() === 'dark'`, mais mémorisée quand
 * même dans ce cas (l'utilisateur choisit sa variante indépendamment du thème sombre/clair actif,
 * comme pour `ColorblindService.profile`). `'a'` (Ardoise Douce) est la variante par défaut. */
export type LightThemeVariant = 'a' | 'b' | 'c' | 'd';

const THEME_KEY = 'wakfu-theme';
const LIGHT_VARIANT_KEY = 'wakfu-light-theme-variant';

const LIGHT_VARIANTS: readonly LightThemeVariant[] = ['a', 'b', 'c', 'd'];

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
  readonly lightVariant = signal<LightThemeVariant>('a');

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

    const storedVariant = this.persistence.getJson<LightThemeVariant>(LIGHT_VARIANT_KEY);
    if (storedVariant && LIGHT_VARIANTS.includes(storedVariant)) {
      this.lightVariant.set(storedVariant);
    }

    // Reflète le thème courant sur <html> à chaque changement — y compris la valeur initiale
    // ci-dessus, `effect()` s'exécute une première fois de façon synchrone au bootstrap.
    effect(() => {
      const theme = this.theme();
      if (typeof document !== 'undefined') {
        document.documentElement.dataset['theme'] = theme;
      }
    });

    // Toujours posé (même en thème sombre, sans effet dans ce cas) — évite un flash de la variante
    // par défaut ('a') au moment où l'utilisateur bascule ensuite en clair.
    effect(() => {
      const variant = this.lightVariant();
      if (typeof document !== 'undefined') {
        document.documentElement.dataset['lightTheme'] = variant;
      }
    });
  }

  setTheme(theme: AppTheme): void {
    if (theme === this.theme()) return;
    this.theme.set(theme);
    this.persistence.setJson(THEME_KEY, theme);
  }

  setLightVariant(variant: LightThemeVariant): void {
    if (variant === this.lightVariant()) return;
    this.lightVariant.set(variant);
    this.persistence.setJson(LIGHT_VARIANT_KEY, variant);
  }
}
