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

/**
 * Clé de comparaison de composition d'ennemis (voir `groupDungeonRuns`, paramètre
 * `enemyCompositionKey`) : ensemble d'espèces DISTINCTES (pas les comptes — une même salle peut
 * légitimement varier de quelques instances d'un essai à l'autre sans changer de nature), triées
 * pour être insensible à l'ordre d'apparition dans le log/la requête SQL.
 */
export function enemyCompositionKey(enemyNames: readonly string[]): string {
  return [...new Set(enemyNames)].sort().join('|');
}

/** Id Ankama de la pierre de donjon associée à un type (récompense de fin de run, un seul objet par
 * type — voir CLAUDE.md) — `TWO_ROOMS`/`THREE_ROOMS`/`FOUR_ROOMS`/`THREE_PLAYERS`/`ULTIMATE_BOSS`
 * uniquement, `null` pour les types sans pierre associée (brèche, arcade). */
const STONE_ITEM_ID_BY_TYPE: Readonly<Partial<Record<WakfuDungeonType, number>>> = {
  TWO_ROOMS: 29849, // pierre de vitesse
  THREE_ROOMS: 29848, // pierre d'équilibre
  FOUR_ROOMS: 29847, // pierre d'aventure
  THREE_PLAYERS: 29850, // pierre d'entourage
  ULTIMATE_BOSS: 29851, // pierre ultime
};

export function dungeonStoneItemId(dungeon: CatalogDungeonEntry): number | null {
  return STONE_ITEM_ID_BY_TYPE[dungeon.type] ?? null;
}

/** Miroir de `dungeonStoneItemId` à partir du seul `type` (pas besoin d'une `CatalogDungeonEntry`
 * complète) — utilisé par le regroupement "Type" de la carte Récap (`SessionRecapComponent.
 * typeRows`), qui fusionne tous les donjons d'un même type et n'a donc pas un donjon précis à
 * passer. */
export function dungeonStoneItemIdForType(type: WakfuDungeonType): number | null {
  return STONE_ITEM_ID_BY_TYPE[type] ?? null;
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
 * contient un archimonstre (voir `CatalogMonsterEntry.isArchi`) ; `roomCompositionKey` renvoie la
 * clé de composition d'ennemis du combat (voir `enemyCompositionKey` ci-dessus), utilisée à l'étape
 * 3 pour décider si une défaite appartient à la même salle que la victoire qui la referme — les
 * trois sont injectés plutôt qu'importés en dur pour rester une fonction pure ne dépendant d'aucun
 * service Angular (même principe que `resolveFightImageInfo`).
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
 * 3. Salles précédentes : jusqu'à `dungeonRoomCount(dungeon) - 1` salles supplémentaires (plus
 *    anciennes encore) — PAS `dungeonRoomCount(dungeon) - 1` COMBATS. Une salle peut avoir été
 *    perdue puis retentée un nombre arbitraire de fois avant d'être gagnée : tous les combats
 *    consécutifs qui séparent deux salles réussies appartiennent à la salle la plus récente des
 *    deux (bug réel corrigé le 2026-08-26, voir dungeon-run-grouping.util.spec.ts — l'ancienne
 *    version comptait `roomSlots` COMBATS bruts au lieu de `roomSlots` VICTOIRES, ce qui décalait
 *    la fenêtre de collecte dès qu'une salle avait été retentée et faisait perdre la salle la plus
 *    ancienne du run, hors de la fenêtre). Concrètement : on avance combat par combat, une salle
 *    n'est "comptée" (roomsFound++) que lorsqu'on rencontre une VICTOIRE ; toute DÉFAITE rencontrée
 *    n'est ramassée comme tentative ratée de la salle EN COURS que si sa composition d'ennemis
 *    (`enemyCompositionKey`) correspond EXACTEMENT à celle de la victoire qui la referme — sinon
 *    c'est un combat sans rapport (résolu normalement comme hors-donjon), et la fenêtre de collecte
 *    s'arrête ici. Un combat qui inclut n'importe quel boss de donjon interrompt aussitôt ce
 *    ramassage (garde-fou : n'avale jamais la fin d'un run antérieur distinct), de même qu'une
 *    VICTOIRE une fois `roomSlots` déjà atteint (salle en trop = run antérieur distinct).
 *
 *    Fix 2026-08-30 (remonté par l'utilisateur, cas réel : donjon `TWO_ROOMS` où la seule salle
 *    avait été perdue une fois puis regagnée 2 min plus tard) : la version précédente s'arrêtait
 *    dès que `roomsFound` atteignait sa cible SANS jamais regarder plus loin en arrière, laissant
 *    orpheline (classée hors-donjon) toute défaite précédant IMMÉDIATEMENT la victoire qui la
 *    referme — un cas fréquent pour la toute dernière salle avant le boss, celle où l'ordre
 *    naturel place la victoire AVANT ses propres défaites antérieures dans le sens de parcours
 *    (plus récent → plus ancien). La vérification de composition (au lieu d'un simple "toute
 *    défaite croisée compte", l'approximation d'origine) évite en retour d'avaler à tort un combat
 *    RÉELLEMENT sans rapport (une salle différente ou un combat hors donjon) qui se trouverait par
 *    hasard immédiatement adjacent — demande explicite de l'utilisateur, en remplacement d'un
 *    garde-fou par seuil de temps (rejeté : une vraie pause en plein donjon peut largement dépasser
 *    quelques minutes sans que ce soit un problème).
 *
 * Un groupe d'un seul combat (salle manquante en tout début d'historique) redevient une entrée
 * `single` classique plutôt qu'un collapse à un seul élément.
 */
export function groupDungeonRuns<T extends DungeonGroupableFight>(
  records: readonly T[],
  findDungeon: (record: T) => CatalogDungeonEntry | null,
  hasArchiEnemy: (record: T) => boolean,
  roomCompositionKey: (record: T) => string,
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

    // Salles précédentes (étape 3, voir doc de tête pour l'historique du fix 2026-08-30) : on
    // avance combat par combat. Une VICTOIRE compte pour une salle (sauf si `roomSlots` est déjà
    // atteint : une salle en trop signale la fin d'un run antérieur distinct, on s'arrête sans la
    // consommer). Une DÉFAITE n'est ramassée comme tentative ratée de la salle EN COURS que si sa
    // composition d'ennemis correspond EXACTEMENT à celle de la victoire qui la referme (`currentRoomKey`,
    // mis à jour à chaque nouvelle victoire de salle) — sinon c'est un combat sans rapport, la
    // fenêtre de collecte s'arrête ici. Un combat de boss (ce donjon ou un autre) interrompt
    // toujours ce ramassage (garde-fou : n'avale jamais la fin d'un run antérieur distinct).
    const roomSlots = dungeonRoomCount(dungeon) - 1;
    let roomsFound = 0;
    let currentRoomKey: string | null = null;
    while (j < records.length) {
      const candidate = findDungeon(records[j]);
      if (candidate) break;
      const record = records[j];
      if (record.result === 'won') {
        if (roomsFound >= roomSlots) break;
        currentRoomKey = roomCompositionKey(record);
        roomsFound++;
        j++;
        continue;
      }
      if (currentRoomKey !== null && roomCompositionKey(record) === currentRoomKey) {
        j++;
        continue;
      }
      break;
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
