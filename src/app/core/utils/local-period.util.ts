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

/**
 * Inverse de `periodBounds` : le `periodOffset` (voir `SessionRecapComponent`) dont la période
 * CONTIENT `targetMs`, relativement à la période contenant `nowMs` — utilisée par le mini
 * calendrier de navigation (`PeriodPickerComponent`) pour convertir une date choisie par clic en
 * un pas de stepper.
 *
 * `day` : différence de JOURS CALENDAIRES entre les deux dates, calculée via `Date.UTC(y, m, d)`
 * sur les deux dates plutôt qu'une simple division de millisecondes — une division directe
 * casserait autour d'un changement d'heure été/hiver (un jour local peut durer 23h ou 25h, jamais
 * exactement 24h à ce moment-là) ; `Date.UTC` avec des composants année/mois/jour explicites donne
 * en revanche un nombre de jours calendaires exact, chaque "jour UTC" valant toujours 24h pile.
 * `month`/`year` : simple arithmétique sur les composants année/mois (aucun piège de fuseau
 * horaire à ce niveau de granularité).
 */
export function offsetForPeriodStart(
  granularity: PeriodGranularity,
  targetMs: number,
  nowMs: number,
): number {
  const target = new Date(targetMs);
  const now = new Date(nowMs);
  if (granularity === 'day') {
    const targetUtc = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
    const nowUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((targetUtc - nowUtc) / 86_400_000);
  }
  if (granularity === 'month') {
    return (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  }
  return target.getFullYear() - now.getFullYear();
}

/** Date fixe, IDENTIQUE POUR TOUT LE MONDE (pas propre à chaque utilisateur) : aucune donnée
 * serveur n'existe avant ce jour (lancement de l'historique serveur côté compte, voir
 * server/README.md "lot 8", migration `0006_history_tables.sql`) — sert de vraie borne minimale de
 * navigation (voir `minOffsetForGranularity`), demandée explicitement par l'utilisateur le
 * 2026-08-28 en remplacement de l'ancien garde-fou arbitraire (`OFFSET_MIN`,
 * `SessionRecapComponent`, ±10 ans sans rapport avec les données réellement disponibles). À
 * repousser manuellement seulement si l'historique serveur venait à être repurgé/relancé depuis
 * une date plus tardive — ne peut techniquement pas AVANCER davantage dans le passé, aucune donnée
 * n'y a jamais existé. */
export const HISTORY_TRACKING_START_MS = new Date(2026, 7, 1).getTime();

/** Borne minimale de navigation (voir `SessionRecapComponent.offsetMin`) pour `granularity` : le
 * pas (négatif ou nul) de la période civile locale contenant `HISTORY_TRACKING_START_MS`,
 * relativement à la période contenant `nowMs` — réutilise `offsetForPeriodStart` tel quel plutôt
 * que d'écrire un second calcul de date, `HISTORY_TRACKING_START_MS` n'étant qu'une cible comme une
 * autre pour cette fonction. */
export function minOffsetForGranularity(granularity: PeriodGranularity, nowMs: number): number {
  return offsetForPeriodStart(granularity, HISTORY_TRACKING_START_MS, nowMs);
}
