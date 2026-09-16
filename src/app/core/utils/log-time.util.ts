/**
 * Heure locale au format des lignes du log Wakfu (`HH:MM:SS,mmm`), reconstruite depuis un
 * horodatage complet (ISO, epoch ms ou `Date`) — le format attendu par `FightRecord.time` et
 * consorts, jamais l'inverse (le log n'expose que l'heure, voir StatsStoreService.
 * buildFullTimestampMs pour la reconstruction de la date). Partagée par l'archive du compte
 * (HistoryArchiveService, combats archivés) et StatsStoreService (combats interrompus, dont l'heure
 * de fin est un horodatage complet déjà calculé et non une ligne du fichier).
 */
export function toLogTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '00:00:00,000';
  const pad = (n: number, size = 2): string => n.toString().padStart(size, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())},${pad(
    date.getMilliseconds(),
    3,
  )}`;
}
