import { Injectable, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';
import { TRANSLATIONS } from '../i18n/translations';
import { WAKFU_ITEMS_FR } from '../data/wakfu-items.data';

export type AppLocale = 'fr' | 'en' | 'es' | 'pt';

export const SUPPORTED_LOCALES: readonly AppLocale[] = ['fr', 'en', 'es', 'pt'];

const LOCALE_KEY = 'wakfu-locale';

const LOCALE_TAGS: Record<AppLocale, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
  es: 'es-ES',
  pt: 'pt-PT',
};

/**
 * Traduction d'exécution (pas de compilation par locale à la `@angular/localize`) :
 * nécessaire pour permettre à l'utilisateur de changer de langue en un clic,
 * sans recharger l'application.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly locale = signal<AppLocale>('fr');

  constructor(private readonly persistence: PersistenceService) {
    const stored = this.persistence.getJson<AppLocale>(LOCALE_KEY);
    if (stored && SUPPORTED_LOCALES.includes(stored)) {
      this.locale.set(stored);
    }
  }

  setLocale(locale: AppLocale): void {
    this.locale.set(locale);
    this.persistence.setJson(LOCALE_KEY, locale);
  }

  t(key: string): string {
    const locale = this.locale();
    return TRANSLATIONS[locale]?.[key] ?? TRANSLATIONS.fr[key] ?? key;
  }

  /** Formate un horodatage (epoch ms) selon les conventions de la langue courante. */
  formatDateTime(ms: number): string {
    return new Intl.DateTimeFormat(LOCALE_TAGS[this.locale()], {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(new Date(ms));
  }

  /** Traduit un nom d'objet (butin, suivi) via le référentiel officiel Ankama ; conserve le nom FR si non trouvé ou si la locale est FR. */
  translateItemName(frName: string): string {
    const locale = this.locale();
    if (locale === 'fr') return frName;
    const entry = WAKFU_ITEMS_FR[frName.toLowerCase().trim()];
    const translated = entry?.[locale];
    return translated ? translated : frName;
  }
}
