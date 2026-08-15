import { CatalogDungeonEntry, WakfuDungeonType } from '../api/catalog.service';

/** Nombre de salles précédant le boss (boss compris) pour un clear "propre" d'un donjon, déduit de
 * son `type` (voir CatalogDungeonEntry) — remplace l'ancien `roomCount` curé séparément. Seuls
 * `TWO_ROOMS`/`THREE_ROOMS`/`FOUR_ROOMS` ont plusieurs salles ; tous les autres types (donjon 3
 * joueurs, boss ultime, brèche, arcade...) désignent un donjon à un seul combat. */
const ROOM_COUNT_BY_TYPE: Readonly<Record<WakfuDungeonType, number>> = {
  TWO_ROOMS: 2,
  THREE_ROOMS: 3,
  FOUR_ROOMS: 4,
  THREE_PLAYERS: 1,
  ULTIMATE_BOSS: 1,
  BREACH: 1,
  ULTIMATE_BREACH: 1,
  ARCADE: 1,
};

export function dungeonRoomCount(dungeon: CatalogDungeonEntry): number {
  return ROOM_COUNT_BY_TYPE[dungeon.type];
}

/** Combat minimal requis pour le regroupement — `FightRecord` (stats-store.service.ts) satisfait
 * largement cette contrainte, une contrainte structurelle plutôt qu'un import direct évite une
 * dépendance circulaire entre ce fichier et le store. */
export interface DungeonGroupableFight {
  id: number;
  result: 'won' | 'lost';
}

export type DungeonHistoryEntry<T extends DungeonGroupableFight> =
  | { kind: 'single'; record: T }
  | {
      kind: 'dungeonRun';
      dungeon: CatalogDungeonEntry;
      /** Combats du run, du plus RÉCENT au plus ANCIEN (boss -> ... -> salle 2 -> salle 1) — même
       * ordre que `records` en entrée (voir `HistoryArchiveService.mergedFights`), demandé
       * explicitement pour la lecture d'un run déplié (le dernier combat d'abord, puis
       * l'avant-dernier, etc.) plutôt qu'un déroulé chronologique salle par salle. */
      fights: T[];
      /** Combat le plus récent du run (premier de `fights`) — sert de repère pour le
       * regroupement jour/lieu/type existant (date, image de l'entrée...). */
      representative: T;
    };

/**
 * Regroupe les combats d'un même donjon (salles + tentatives de boss) au sein de l'historique —
 * voir CLAUDE.md "regroupement des combats de donjon multi-salles" pour les règles métier.
 *
 * `records` doit être trié du plus récent au plus ancien (même convention que
 * `HistoryArchiveService.mergedFights`, déjà utilisée par tout l'historique) : ce tri est ce qui
 * permet de scanner vers l'arrière dans le temps sans avoir à re-trier quoi que ce soit.
 * `findDungeon` identifie le donjon dont un combat contient le boss (voir
 * `findDungeonForEnemies`, fight-image.util.ts) ; `hasArchiEnemy` détecte si un combat (non-boss)
 * contient un archimonstre (voir `CatalogMonsterEntry.isArchi`) — les deux sont injectés plutôt
 * qu'importés en dur pour rester une fonction pure ne dépendant d'aucun service Angular (même
 * principe que `resolveFightImageInfo`).
 *
 * Algorithme, pour chaque combat de boss encore non consommé (parcouru du plus récent au plus
 * ancien) :
 * 0. Donjons à un seul combat (`dungeonRoomCount(dungeon) === 1` — donjon 3 joueurs, boss ultime,
 *    brèche, arcade...) : JAMAIS regroupés, quel que soit le résultat — même des défaites répétées
 *    contre le même boss restent des entrées `single` distinctes. Seuls les types à plusieurs
 *    salles (`TWO_ROOMS`/`THREE_ROOMS`/`FOUR_ROOMS`) passent aux étapes suivantes.
 * 1. Cluster de tentatives contre CE boss précis : le combat de départ (le plus récent contre ce
 *    boss) en fait toujours partie, quel que soit son résultat. Les combats plus anciens
 *    (défaites uniquement — une VICTOIRE plus ancienne appartient déjà à un run précédent
 *    distinct, jamais à celui-ci) contre ce même boss le rejoignent tant qu'ils sont consécutifs —
 *    couvre le cas de plusieurs défaites suivies d'une victoire, comme un abandon pur (aucune
 *    victoire, le cluster ne contient alors que des défaites).
 * 2. Archimonstre pré-boss optionnel (`hasPreBossArchi`, ex. Kokokolantha) : le combat qui suit
 *    IMMÉDIATEMENT le cluster de boss (donc le dernier avant le boss chronologiquement) ne
 *    rejoint le run à ce titre QUE s'il contient effectivement un archimonstre
 *    (`hasArchiEnemy`) — `hasPreBossArchi` indique seulement qu'un tel combat PEUT exister pour ce
 *    donjon, pas qu'il a eu lieu cette fois-ci (bug corrigé : l'ancienne version rattachait un
 *    5e combat même sans archimonstre dedans, dès que `hasPreBossArchi` était vrai).
 * 3. Salles précédentes : jusqu'à `dungeonRoomCount(dungeon) - 1` combats consécutifs
 *    supplémentaires (plus anciens encore), qu'ils soient gagnés ou perdus (garde-fou explicite :
 *    une salle perdue puis retentée reste correctement rattachée au groupe). Un combat qui inclut
 *    n'importe quel boss de donjon interrompt aussitôt ce ramassage (garde-fou : n'avale jamais la
 *    fin d'un run antérieur distinct).
 *
 * Un groupe d'un seul combat (salle manquante en tout début d'historique) redevient une entrée
 * `single` classique plutôt qu'un collapse à un seul élément.
 */
export function groupDungeonRuns<T extends DungeonGroupableFight>(
  records: readonly T[],
  findDungeon: (record: T) => CatalogDungeonEntry | null,
  hasArchiEnemy: (record: T) => boolean,
): DungeonHistoryEntry<T>[] {
  const entries: DungeonHistoryEntry<T>[] = [];
  const consumed = new Array<boolean>(records.length).fill(false);

  for (let i = 0; i < records.length; i++) {
    if (consumed[i]) continue;

    const dungeon = findDungeon(records[i]);
    if (!dungeon) {
      entries.push({ kind: 'single', record: records[i] });
      consumed[i] = true;
      continue;
    }

    // Donjon à un seul combat : jamais regroupé (voir étape 0 de la doc ci-dessus), même en cas de
    // tentatives répétées contre le même boss.
    if (dungeonRoomCount(dungeon) === 1) {
      entries.push({ kind: 'single', record: records[i] });
      consumed[i] = true;
      continue;
    }

    // `records[i]` fait partie du cluster quel que soit son résultat (c'est la tentative la plus
    // RÉCENTE contre ce boss, trouvée en premier puisque le tableau est trié plus récent d'abord).
    // Les tentatives plus anciennes (indices croissants) ne rejoignent le cluster que tant
    // qu'elles sont des DÉFAITES contre ce même boss : une victoire plus ancienne appartient déjà
    // à un run précédent distinct (déjà résolu ou à résoudre par une itération ultérieure), jamais
    // à celui-ci — on s'arrête donc avant de la consommer.
    let j = i + 1;
    while (j < records.length) {
      const candidate = findDungeon(records[j]);
      if (!candidate || candidate.id !== dungeon.id || records[j].result === 'won') break;
      j++;
    }

    // Créneau archimonstre optionnel (voir étape 2) : consommé seulement s'il est réellement
    // présent dans ce combat précis, jamais sur la seule foi de `hasPreBossArchi`.
    if (
      dungeon.hasPreBossArchi &&
      j < records.length &&
      !findDungeon(records[j]) &&
      hasArchiEnemy(records[j])
    ) {
      j++;
    }

    const roomSlots = dungeonRoomCount(dungeon) - 1;
    let roomsFound = 0;
    while (roomsFound < roomSlots && j < records.length && !findDungeon(records[j])) {
      j++;
      roomsFound++;
    }

    for (let k = i; k < j; k++) consumed[k] = true;

    const span = records.slice(i, j);
    if (span.length <= 1) {
      entries.push({ kind: 'single', record: records[i] });
      continue;
    }

    entries.push({
      kind: 'dungeonRun',
      dungeon,
      fights: span,
      representative: records[i],
    });
  }

  return entries;
}
