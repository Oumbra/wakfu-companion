import { Injectable, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';
import { TRANSLATIONS } from '../i18n/translations';
import { findWakfuItemEntry } from '../data/wakfu-items.data';
import { findWakfuMonsterEntry } from '../data/wakfu-monsters.data';

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

  t(key: string, params?: Record<string, string | number>): string {
    const locale = this.locale();
    const raw = TRANSLATIONS[locale]?.[key] ?? TRANSLATIONS.fr[key] ?? key;
    if (!params) return raw;
    return raw.replace(/\{\{(\w+)\}\}/g, (_, name) => String(params[name] ?? ''));
  }

  /** Formate un horodatage (epoch ms) selon les conventions de la langue courante. */
  formatDateTime(ms: number): string {
    return new Intl.DateTimeFormat(LOCALE_TAGS[this.locale()], {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(new Date(ms));
  }

  /** Formate uniquement la date (sans l'heure) — utilisé pour les en-têtes de
   * regroupement par jour (voir purchases.component.ts). */
  formatDate(ms: number): string {
    return new Intl.DateTimeFormat(LOCALE_TAGS[this.locale()], { dateStyle: 'medium' }).format(
      new Date(ms),
    );
  }

  /** Traduit un nom d'objet (butin, suivi) via le référentiel officiel Ankama
   * vers la locale courante de l'app. `name` peut être dans n'importe
   * laquelle des 4 langues (le client Wakfu de l'utilisateur n'est pas
   * forcément en français) : `findWakfuItemEntry` le retrouve quelle que
   * soit sa langue d'origine. Conserve `name` tel quel si l'objet est
   * introuvable dans le référentiel. */
  translateItemName(name: string): string {
    const entry = findWakfuItemEntry(name);
    const translated = entry?.[this.locale()];
    return translated ? translated : name;
  }

  /** Traduit un nom de monstre (dégâts, suivi) via le référentiel officiel
   * Ankama vers la locale courante de l'app — voir `translateItemName`. */
  translateMonsterName(name: string): string {
    const entry = findWakfuMonsterEntry(name);
    const translated = entry?.[this.locale()];
    return translated ? translated : name;
  }
}
