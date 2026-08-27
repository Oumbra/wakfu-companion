import { PeriodGroupTotals } from '../sync/history-stats.service';

/**
 * Fusionne plusieurs groupes (`PeriodGroupTotals`, voir `HistoryStatsService`) en un seul —
 * utilisé par `SessionRecapComponent` pour construire les buckets du mode d'affichage "Type"
 * (regroupement plus grossier que "Donjon & Famille", voir CLAUDE.md) : un bucket "Type" fusionne
 * TOUS les donjons d'un même `WakfuDungeonType`, ou TOUTE `period.families` pour le bucket
 * "Autres" — entièrement côté client, aucune requête serveur supplémentaire (les données brutes,
 * `period.dungeons`/`period.families`, sont déjà chargées).
 *
 * `xpByCharacter`/`loot` sont fusionnés en sommant les montants/quantités par clé (`name`
 * respectivement `itemId`/`itemName`, mutuellement exclusifs comme partout dans l'historique).
 * `rows` vide renvoie un groupe entièrement à zéro plutôt que de lever — un bucket "Type" sans
 * aucun donjon rencontré sur la période ne doit simplement pas être affiché par l'appelant.
 */
export function mergeGroupTotals(rows: readonly PeriodGroupTotals[]): PeriodGroupTotals {
  const merged: PeriodGroupTotals = {
    fights: 0,
    won: 0,
    lost: 0,
    kamasGained: 0,
    xpGained: 0,
    xpByCharacter: [],
    loot: [],
  };

  const xpByName = new Map<string, number>();
  const lootByKey = new Map<
    string,
    { itemId: number | null; itemName: string | null; quantity: number }
  >();

  for (const row of rows) {
    merged.fights += row.fights;
    merged.won += row.won;
    merged.lost += row.lost;
    merged.kamasGained += row.kamasGained;
    merged.xpGained += row.xpGained;

    for (const xp of row.xpByCharacter) {
      xpByName.set(xp.name, (xpByName.get(xp.name) ?? 0) + xp.amount);
    }
    for (const item of row.loot) {
      const key = item.itemId !== null ? `id:${item.itemId}` : `name:${item.itemName}`;
      const existing = lootByKey.get(key);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        lootByKey.set(key, { ...item });
      }
    }
  }

  merged.xpByCharacter = Array.from(xpByName, ([name, amount]) => ({ name, amount }));
  merged.loot = Array.from(lootByKey.values());
  return merged;
}
