/**
 * Bornes de périodes CALENDAIRES LOCALES (fuseau horaire du navigateur, jamais UTC) — un jour/mois/
 * année au sens civil, pas une fenêtre glissante de 24h/30j/365j. Utilisé pour tout regroupement
 * temporel côté client :
 * - `localDayStart` pilotait déjà `HistoryArchiveService.loadMorePurchasesUntilDayComplete` (et
 *   `I18nService.formatRelativeDay`, même découpage) — extrait ici plutôt que dupliqué.
 * - `localMonthStart`/`localYearStart` alimentent le switch Session/Jour/Mois/Année de la carte
 *   Récap (`SessionRecapComponent`/`HistoryStatsService`) : les bornes sont calculées ICI, côté
 *   client, et envoyées au serveur en instants ISO explicites (`since`/`until`,
 *   `GET /api/v1/history/stats`) — jamais un paramètre `granularity` interprété côté serveur, qui
 *   ne connaît pas le fuseau horaire de l'utilisateur (voir server/README.md).
 * - `addLocalDays`/`addLocalMonths`/`addLocalYears`/`periodBounds` alimentent la navigation vers
 *   une période PASSÉE (stepper ‹ › de `SessionRecapComponent`, ajoutée le 2026-08-26) — décalage
 *   d'un nombre entier de périodes calendaires depuis la période contenant `nowMs`, jamais une
 *   arithmétique en millisecondes (casserait autour des changements d'heure été/hiver et de la
 *   longueur variable des mois). S'appuient sur le constructeur `Date(année, mois, jour)`, qui
 *   normalise nativement un débordement de composant (ex. mois 13 → janvier de l'année suivante) :
 *   pas besoin de gérer soi-même le report de retenue.
 */

/** Début du jour calendaire LOCAL (minuit) contenant `timestampMs`. */
export function localDayStart(timestampMs: number): number {
  const d = new Date(timestampMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Début du mois calendaire LOCAL (1er du mois, minuit) contenant `timestampMs`. */
export function localMonthStart(timestampMs: number): number {
  const d = new Date(timestampMs);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** Début de l'année calendaire LOCALE (1er janvier, minuit) contenant `timestampMs`. */
export function localYearStart(timestampMs: number): number {
  const d = new Date(timestampMs);
  return new Date(d.getFullYear(), 0, 1).getTime();
}

/** Décale un début de jour LOCAL (voir `localDayStart`) de `days` jours (négatif = passé). */
export function addLocalDays(startMs: number, days: number): number {
  const d = new Date(startMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

/** Décale un début de mois LOCAL (voir `localMonthStart`) de `months` mois. */
export function addLocalMonths(startMs: number, months: number): number {
  const d = new Date(startMs);
  return new Date(d.getFullYear(), d.getMonth() + months, 1).getTime();
}

/** Décale un début d'année LOCALE (voir `localYearStart`) de `years` années. */
export function addLocalYears(startMs: number, years: number): number {
  const d = new Date(startMs);
  return new Date(d.getFullYear() + years, 0, 1).getTime();
}

/** Granularités NAVIGABLES du switch de la carte Récap — `'session'` (contenu du fichier connecté,
 * pas une période calendaire) en est volontairement exclu, voir `SessionRecapComponent`. */
export type PeriodGranularity = 'day' | 'month' | 'year';

/**
 * Bornes `[start, end)` de la période civile locale à `offset` pas de la période CONTENANT
 * `nowMs` — `0` = période en cours, négatif = passé (jamais positif : `SessionRecapComponent` borne
 * le stepper à `max = 0`, aucune période future n'a de sens). `end` est TOUJOURS le début de la
 * période SUIVANTE, y compris pour `offset = 0` (période en cours) — une seule formule pour tous
 * les offsets plutôt qu'un cas spécial "jusqu'à maintenant" pour la période courante : aucun combat
 * ne peut avoir un horodatage futur, la requête ne renverra donc jamais que ce qui existe déjà,
 * même en demandant une borne haute théoriquement plus large ("jusqu'à demain minuit").
 */
export function periodBounds(
  granularity: PeriodGranularity,
  offset: number,
  nowMs: number,
): { start: number; end: number } {
  if (granularity === 'day') {
    const start = addLocalDays(localDayStart(nowMs), offset);
    return { start, end: addLocalDays(start, 1) };
  }
  if (granularity === 'month') {
    const start = addLocalMonths(localMonthStart(nowMs), offset);
    return { start, end: addLocalMonths(start, 1) };
  }
  const start = addLocalYears(localYearStart(nowMs), offset);
  return { start, end: addLocalYears(start, 1) };
}
