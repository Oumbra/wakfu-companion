import { TestBed } from '@angular/core/testing';
import { I18nService, AppLocale } from '../core/services/i18n.service';
import { LocaleNumberPipe } from './locale-number.pipe';

const LOCALE_TAGS: Record<AppLocale, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
  es: 'es-ES',
  pt: 'pt-PT',
};

/** Instancie le pipe avec un `I18nService` factice figé sur `locale` — évite de construire le
 * vrai service (dépendances `PersistenceService`/`CatalogService` non pertinentes ici) tout en
 * passant par un contexte d'injection réel (`TestBed.runInInjectionContext`), requis par
 * `inject()` au niveau champ du pipe. */
function createPipe(locale: AppLocale): LocaleNumberPipe {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: I18nService,
        useValue: {
          formatNumber: (n: number) => new Intl.NumberFormat(LOCALE_TAGS[locale]).format(n),
        },
      },
    ],
  });
  return TestBed.runInInjectionContext(() => new LocaleNumberPipe());
}

describe('LocaleNumberPipe', () => {
  // `Intl.NumberFormat('fr-FR')` sépare les milliers par une espace fine insécable (U+202F), pas
  // une espace normale (U+0020) ni une espace insécable classique (U+00A0) — point de code
  // explicite plutôt qu'un caractère littéral entre quotes, qui s'est avéré silencieusement
  // normalisé vers un autre caractère "espace" au premier jet de ce fichier (test qui échouait
  // alors que la différence était invisible à l'oeil dans l'éditeur/le terminal).
  const NBSP = String.fromCharCode(0x202f);

  it('formate un nombre à la française quand la locale est fr', () => {
    expect(createPipe('fr').transform(1636978482)).toBe(`1${NBSP}636${NBSP}978${NBSP}482`);
  });

  it('formate un nombre avec des virgules quand la locale est en (pas "à la française")', () => {
    // Régression réelle : l'ancien NumberFrPipe formatait toujours en fr-FR, quelle que soit la
    // locale active — remonté par l'utilisateur après un test en anglais/espagnol/portugais.
    expect(createPipe('en').transform(1636978482)).toBe('1,636,978,482');
  });

  it('formate une chaîne numérique de la même façon qu’un number', () => {
    // Cas réel : une agrégation SQL (sum/count) renvoyée par le driver Postgres en chaîne (voir
    // functions/api/v1/history/stats.ts) — sans coercition, `"1636978482".toLocaleString(...)`
    // retombe sur Object.prototype.toLocaleString et renvoie la chaîne brute non séparée.
    expect(createPipe('fr').transform('1636978482')).toBe(`1${NBSP}636${NBSP}978${NBSP}482`);
  });

  it('renvoie "0" pour null/undefined/valeur non numérique', () => {
    const pipe = createPipe('fr');
    expect(pipe.transform(null)).toBe('0');
    expect(pipe.transform(undefined)).toBe('0');
    expect(pipe.transform('abc')).toBe('0');
  });

  it('formate zéro et les petits nombres sans séparateur', () => {
    const pipe = createPipe('fr');
    expect(pipe.transform(0)).toBe('0');
    expect(pipe.transform(42)).toBe('42');
  });
});
