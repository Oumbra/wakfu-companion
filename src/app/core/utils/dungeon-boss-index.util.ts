/**
 * Index « boss → donjon » partagé par les TROIS résolveurs boss/donjon de l'app — client
 * (`CatalogService.applyDungeons`, via `findWakfuDungeonByBossMonsterId`), serveur live
 * (`server/history/dungeon-run.ts::loadCatalogFromDb`) et script de rattrapage
 * (`server/import/backfill-dungeon-runs.ts::loadCatalog`) — pour qu'ils ne divergent jamais
 * (même précédent d'import `server/` → `src/app/core/utils/` que `wakfu-name.util.ts`).
 *
 * Priorité : un boss est d'abord rattaché à son donjon CLASSIQUE (tout type sauf `BREACH`/
 * `ULTIMATE_BREACH`) ; une brèche n'est retenue pour un boss que si AUCUN donjon classique ne le
 * réclame (repli théorique, aucun cas connu à ce jour : les 27 boss des 3 brèches ultimes sont tous
 * boss d'un donjon classique). Bug réel corrigé le 2026-09-13 (fichier utilisateur, Donjon Flaqueux) :
 * l'ancienne construction « premier arrivé gagne » sur l'ordre brut du référentiel faisait gagner
 * la brèche ultime dès qu'elle précédait le donjon classique — ordre du JSON pour le script de
 * rattrapage, ordre PHYSIQUE des lignes de la table `dungeons` (aucun `ORDER BY`) pour l'API et le
 * serveur, donc potentiellement n'importe lequel des 27 boss selon l'environnement. Un combat de
 * boss seul se retrouvait alors classé « Brèche dimensionnelle de Frigost » (illustration générique,
 * pas de regroupement des salles, `dungeonId`/`fight_type` faux en base — 57 combats en prod).
 *
 * Une brèche ultime ne se reconnaît jamais par UN boss : elle réunit PLUSIEURS boss distincts dans
 * le même combat et est résolue en amont, avant cet index, par `findWakfuUltimateBreachByBossMonsters`
 * (priorité 0 de `findDungeonForEnemies`, `fight-image.util.ts`) — cet index ne sert qu'à la
 * priorité 1 (boss unique), où seul le donjon classique a un sens.
 */
export interface DungeonBossIndexEntry {
  type: string;
  bossMonsterId: readonly number[];
}

export function isBreachDungeonType(type: string): boolean {
  return type === 'BREACH' || type === 'ULTIMATE_BREACH';
}

export function indexDungeonsByBossMonsterId<T extends DungeonBossIndexEntry>(
  dungeons: readonly T[],
): Map<number, T> {
  const byBossMonsterId = new Map<number, T>();
  const classicFirst = [
    ...dungeons.filter((dungeon) => !isBreachDungeonType(dungeon.type)),
    ...dungeons.filter((dungeon) => isBreachDungeonType(dungeon.type)),
  ];
  for (const dungeon of classicFirst) {
    for (const bossMonsterId of dungeon.bossMonsterId) {
      if (!byBossMonsterId.has(bossMonsterId)) byBossMonsterId.set(bossMonsterId, dungeon);
    }
  }
  return byBossMonsterId;
}
