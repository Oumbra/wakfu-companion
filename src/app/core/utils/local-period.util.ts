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
