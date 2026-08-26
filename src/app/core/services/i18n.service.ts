import { Injectable, inject, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';
import { TRANSLATIONS } from '../i18n/translations';
import { CatalogService } from '../api/catalog.service';

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
 * Locale à utiliser à défaut d'indication explicite dans l'URL (voir `app.routes.ts`,
 * `LocaleRouteComponent`) : préférence mémorisée en premier (choix explicite d'une visite
 * précédente), sinon langue du navigateur si elle fait partie des 4 supportées, sinon français.
 * Utilisée par les redirections `redirectTo` de `app.routes.ts` (URL sans préfixe de langue : `/`,
 * `/profile`...) ET par le constructeur ci-dessous en dernier recours (voir `localeFromCurrentUrl`
 * juste en dessous, prioritaire quand l'URL initiale porte déjà un préfixe de langue) — d'où
 * l'export en fonction indépendante plutôt qu'une méthode d'instance.
 */
export function detectPreferredLocale(persistence: PersistenceService): AppLocale {
  const stored = persistence.getJson<AppLocale>(LOCALE_KEY);
  if (stored && SUPPORTED_LOCALES.includes(stored)) {
    return stored;
  }
  const browserLang = (typeof navigator !== 'undefined' ? navigator.language : '').slice(
    0,
    2,
  ) as AppLocale;
  return SUPPORTED_LOCALES.includes(browserLang) ? browserLang : 'fr';
}

/**
 * Lit le préfixe de langue directement dans l'URL du navigateur (`/fr/...`, `/en/...`...),
 * `null` si absent (URL sans préfixe, sur le point d'être redirigée par `app.routes.ts`) — priorité
 * la plus haute pour la valeur INITIALE de `I18nService.locale` (voir constructeur ci-dessous) :
 * sans ça, une préférence mémorisée périmée (ex. "en" stocké lors d'une visite précédente) gagnerait
 * temporairement contre un lien direct explicite vers `/fr`, le temps que `LocaleRouteComponent`
 * corrige — fenêtre suffisante pour que `RouteSyncService` (dont l'effect peut s'exécuter avant que
 * `LocaleRouteComponent` n'ait eu la main, l'un et l'autre étant construits à des moments différents
 * de l'amorçage du Router) recalcule un chemin depuis cette valeur périmée et détourne la navigation
 * en cours vers `/en` au lieu de `/fr` — bug réel observé en vérification navigateur avant ce correctif.
 * Retire le `<base href>` (voir `--base-href` de `deploy-main.yml`, GitHub Pages sous
 * `/wakfu-companion/`) avant de lire le premier segment.
 */
function localeFromCurrentUrl(): AppLocale | null {
  if (typeof location === 'undefined' || typeof document === 'undefined') return null;
  const baseHref = document.querySelector('base')?.getAttribute('href') ?? '/';
  let path = location.pathname;
  if (baseHref !== '/' && path.startsWith(baseHref)) {
    path = path.slice(baseHref.length);
  }
  const firstSegment = path.split('/').filter(Boolean)[0] as AppLocale | undefined;
  return firstSegment && SUPPORTED_LOCALES.includes(firstSegment) ? firstSegment : null;
}

/**
 * Traduction d'exécution (pas de compilation par locale à la `@angular/localize`) :
 * nécessaire pour permettre à l'utilisateur de changer de langue en un clic,
 * sans recharger l'application.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly catalog = inject(CatalogService);

  readonly locale = signal<AppLocale>('fr');

  constructor(private readonly persistence: PersistenceService) {
    this.locale.set(localeFromCurrentUrl() ?? detectPreferredLocale(persistence));
  }

  setLocale(locale: AppLocale): void {
    this.locale.set(locale);
    this.persistence.setJson(LOCALE_KEY, locale);
  }

  /** `params` accepte `null`/`undefined` en plus de `string | number` : un paramètre "absent" au
   * sens des blocs conditionnels ci-dessous (ex. `position().name` du ClassPicker, `string |
   * null`) doit pouvoir être passé tel quel sans caster côté appelant. */
  t(key: string, params?: Record<string, string | number | null | undefined>): string {
    const locale = this.locale();
    const raw = TRANSLATIONS[locale]?.[key] ?? TRANSLATIONS.fr[key] ?? key;
    return this.interpolate(raw, params);
  }

  /** Interpolation `{{placeholder}}` (substitution simple) + blocs conditionnels optionnels
   * `{{#if param}}...{{else}}...{{/if}}` (le bloc "si" ne s'affiche que si `params[param]` est
   * défini et non vide — chaîne vide/`null`/`undefined` comptent comme "absent", `{{else}}`
   * facultatif). Permet à UNE clé de couvrir un paramètre optionnel (ex. `damageMeter.classOf` :
   * nom de personnage pas toujours connu) sans la dupliquer en deux versions choisies côté code —
   * qui reste la bonne approche pour un vrai singulier/pluriel (voir CLAUDE.md), ce mécanisme
   * couvre le cas complémentaire "paramètre optionnel", pas la pluralisation générale. */
  private interpolate(
    raw: string,
    params?: Record<string, string | number | null | undefined>,
  ): string {
    const withConditionals = raw.replace(
      /\{\{#if (\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
      (_match, name: string, truthyBranch: string, falsyBranch = '') =>
        params?.[name] ? truthyBranch : falsyBranch,
    );
    if (!params) return withConditionals;
    return withConditionals.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
      String(params[name] ?? ''),
    );
  }

  /** Formate un horodatage (epoch ms) selon les conventions de la langue courante. */
  formatDateTime(ms: number, showSeconds = true): string {
    return new Intl.DateTimeFormat(LOCALE_TAGS[this.locale()], {
      dateStyle: 'medium',
      timeStyle: showSeconds ? 'medium' : 'short',
    }).format(new Date(ms));
  }

  /** Formate uniquement la date (sans l'heure) — utilisé pour les en-têtes de
   * regroupement par jour (voir purchases.component.ts). */
  formatDate(ms: number): string {
    return new Intl.DateTimeFormat(LOCALE_TAGS[this.locale()], { dateStyle: 'medium' }).format(
      new Date(ms),
    );
  }

  /** Formate "mois année" (ex. "août 2026") — libellé du stepper de navigation par mois de la
   * carte Récap (voir `local-period.util.ts` periodBounds, `SessionRecapComponent`). */
  formatMonth(ms: number): string {
    return new Intl.DateTimeFormat(LOCALE_TAGS[this.locale()], {
      month: 'long',
      year: 'numeric',
    }).format(new Date(ms));
  }

  /** Formate l'année seule (ex. "2026") — pendant de `formatMonth` pour le stepper de navigation
   * par année. */
  formatYear(ms: number): string {
    return new Intl.DateTimeFormat(LOCALE_TAGS[this.locale()], { year: 'numeric' }).format(
      new Date(ms),
    );
  }

  /** Même usage que `formatDate` (en-tête de regroupement par jour — combats/achats/échanges),
   * mais avec des termes relatifs pour les 3 derniers jours ("Aujourd'hui"/"Hier"/"Avant-hier"),
   * bien plus parlants qu'une date complète pour ce cas précis. Repli sur `formatDate` au-delà.
   * Comparaison sur le jour calendaire LOCAL (minuit à minuit), pas sur un delta de 24h glissant —
   * un événement à 23h59 hier et un autre à 00h01 aujourd'hui sont bien deux jours différents,
   * quel que soit l'écart réel en millisecondes entre les deux. */
  formatRelativeDay(ms: number): string {
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOfDay(new Date()) - startOfDay(new Date(ms))) / 86_400_000);
    if (diffDays === 0) return this.t('date.today');
    if (diffDays === 1) return this.t('date.yesterday');
    if (diffDays === 2) return this.t('date.dayBeforeYesterday');
    return this.formatDate(ms);
  }

  /** Traduit un nom d'objet (butin, suivi) via le référentiel officiel Ankama
   * vers la locale courante de l'app. `name` peut être dans n'importe
   * laquelle des 4 langues (le client Wakfu de l'utilisateur n'est pas
   * forcément en français) : `findWakfuItemEntry` le retrouve quelle que
   * soit sa langue d'origine. Conserve `name` tel quel si l'objet est
   * introuvable dans le référentiel. */
  translateItemName(name: string): string {
    const entry = this.catalog.findWakfuItemEntry(name);
    const translated = entry?.[this.locale()];
    return translated ? translated : name;
  }

  /** Mirroir de `translateItemName`, mais résolution non ambiguë par id Ankama (voir
   * `CatalogService.findWakfuItemEntryById`) — à préférer dès que l'id est connu (ex. objet corrigé
   * manuellement via ItemPickerService, ou ligne d'historique de compte, qui ne porte plus que
   * l'id depuis le retrait de `item_name` côté serveur). `fallback` est renvoyé tel quel si l'id est
   * `null` ou introuvable dans le catalogue. */
  translateItemNameById(id: number | null, fallback: string): string {
    if (id === null) return fallback;
    const entry = this.catalog.findWakfuItemEntryById(id);
    return entry?.[this.locale()] ?? fallback;
  }

  /** Traduit un nom de monstre (dégâts, suivi) via le référentiel officiel
   * Ankama vers la locale courante de l'app — voir `translateItemName`. */
  translateMonsterName(name: string): string {
    const entry = this.catalog.findWakfuMonsterEntry(name);
    const translated = entry?.[this.locale()];
    return translated ? translated : name;
  }
}
