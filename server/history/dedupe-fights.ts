/**
 * Repérage des combats DUPLIQUÉS par l'ancien bug client de renvoi depuis l'archive (2026-09-23) :
 * une correction faite sur un combat rechargé depuis l'archive du compte (réattribution de sort,
 * correction d'objet) était renvoyée avec une signature portant l'`id` d'affichage NÉGATIF du
 * combat archivé — donc une `clientKey` neuve à chaque renvoi — et sans `fightId` du log
 * (`fight_log_id` NULL). Le serveur créait alors un nouveau combat au lieu de mettre à jour
 * l'original. Corrigé côté client (renvoi sous la `clientKey` d'origine) ; ce module planifie le
 * nettoyage de l'existant, exécuté par `server/import/dedupe-archived-fights.ts`.
 *
 * Pur, sans base : testé dans `dedupe-fights.spec.ts`.
 */

/** Un combat candidat, tel que lu en base. `seats` : sièges (nom#instance) triés et joints,
 * calculés en SQL — deux combats aux mêmes participants ont exactement la même chaîne. */
export interface FightDedupRow {
  id: number;
  userId: string;
  startedAt: string;
  durationMs: number | null;
  fightLogId: number | null;
  seats: string;
}

export interface FightDedupGroup {
  /** Combat conservé : l'original (celui qui porte un `fight_log_id`, le plus ancien s'il y en a
   * plusieurs), ou à défaut le plus ancien du groupe. */
  keepId: number;
  /** Doublons à effacer — TOUJOURS des combats à `fight_log_id` NULL. */
  deleteIds: number[];
  /** Doublon le plus récent (plus grand `id`) : il porte la DERNIÈRE correction envoyée, que le
   * script reporte sur les participants du combat conservé avant d'effacer. */
  latestDuplicateId: number;
}

/**
 * Groupes de doublons : mêmes `user_id`, `started_at`, `duration_ms` et ensemble de participants
 * (`seats`), avec au moins un membre à `fight_log_id` NULL. Seuls les membres à `fight_log_id`
 * NULL sont effacés, jamais un combat issu directement du log : deux combats RÉELS distincts
 * partageant début, durée et participants (improbable) ne sont donc jamais fusionnés.
 */
export function planFightDedup(rows: readonly FightDedupRow[]): FightDedupGroup[] {
  const groups = new Map<string, FightDedupRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.userId, row.startedAt, row.durationMs, row.seats]);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const plans: FightDedupGroup[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => a.id - b.id);
    const withLogId = sorted.filter((row) => row.fightLogId !== null);
    const keep = withLogId[0] ?? sorted[0];
    const deleteIds = sorted
      .filter((row) => row.id !== keep.id && row.fightLogId === null)
      .map((row) => row.id);
    if (deleteIds.length === 0) continue;
    plans.push({ keepId: keep.id, deleteIds, latestDuplicateId: Math.max(...deleteIds) });
  }
  return plans.sort((a, b) => a.keepId - b.keepId);
}
