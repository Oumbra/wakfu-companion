import { CatalogDungeonEntry } from '../api/catalog.service';

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
      /** Combats du run, du plus ANCIEN au plus RÉCENT (salle 1 -> salle 2 -> ... -> boss) —
       * lecture naturelle d'un déroulé de donjon, à l'inverse de l'ordre "plus récent d'abord"
       * utilisé par `records` en entrée (voir `HistoryArchiveService.mergedFights`). */
      fights: T[];
      /** Combat le plus récent du run (dernier de `fights`) — sert de repère pour le
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
 * `findDungeonForEnemies`, fight-image.util.ts), injecté plutôt qu'importé en dur pour rester une
 * fonction pure ne dépendant d'aucun service Angular (même principe que `resolveFightImageInfo`).
 *
 * Algorithme, pour chaque combat de boss encore non consommé (parcouru du plus récent au plus
 * ancien) :
 * 1. Cluster de tentatives contre CE boss précis : le combat de départ (le plus récent contre ce
 *    boss) en fait toujours partie, quel que soit son résultat. Les combats plus anciens
 *    (défaites uniquement — une VICTOIRE plus ancienne appartient déjà à un run précédent
 *    distinct, jamais à celui-ci) contre ce même boss le rejoignent tant qu'ils sont consécutifs —
 *    couvre le cas de plusieurs défaites suivies d'une victoire, comme un abandon pur (aucune
 *    victoire, le cluster ne contient alors que des défaites).
 * 2. Salles précédentes : jusqu'à `roomCount - 1` combats consécutifs supplémentaires (plus
 *    anciens encore), qu'ils soient gagnés ou perdus (garde-fou explicite : une salle perdue puis
 *    retentée reste correctement rattachée au groupe) — `+ 1` combat de plus si `hasPreBossArchi`
 *    (archimonstre optionnel avant le boss, ex. Kokokolantha). `roomCount` inconnu (`null`, donjon
 *    pas encore catégorisé) équivaut à 1 : pas de salle à rattacher, seul le cluster de tentatives
 *    contre le boss s'applique. Un combat qui inclut n'importe quel boss de donjon interrompt
 *    aussitôt ce ramassage (garde-fou : n'avale jamais la fin d'un run antérieur distinct).
 *
 * Un groupe d'un seul combat (donjon 3 joueurs/boss ultime gagné du premier coup, sans salle)
 * redevient une entrée `single` classique plutôt qu'un collapse à un seul élément.
 */
export function groupDungeonRuns<T extends DungeonGroupableFight>(
  records: readonly T[],
  findDungeon: (record: T) => CatalogDungeonEntry | null,
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

    const extraSlots = (dungeon.roomCount ?? 1) - 1 + (dungeon.hasPreBossArchi ? 1 : 0);
    let roomsFound = 0;
    while (roomsFound < extraSlots && j < records.length && !findDungeon(records[j])) {
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
      fights: [...span].reverse(),
      representative: records[i],
    });
  }

  return entries;
}
