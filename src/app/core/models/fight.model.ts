/** Un allié ayant rejoint le combat (`isControlledByAI=false`) : `breed` identifie sa classe. */
export interface FightAlly {
  name: string;
  breed: number;
}

/** Un ennemi ayant rejoint le combat (`isControlledByAI=true`) : `id` est son identifiant de combattant (valeur entre crochets de la ligne `[_FL_]`), unique pour cette instance de combat. */
export interface FightEnemy {
  name: string;
  id: number;
}

/**
 * Fiabilité de la résolution d'un objet de butin par recoupement avec les tables de drop connues
 * des monstres du combat (`monsters.loot`, voir StatsStoreService.resolveLootConfidence) :
 * - `'confirmed'` : l'id résolu (éventuellement corrigé parmi des homonymes de rareté différente,
 *   voir `catalogId`) figure dans le butin connu d'au moins un monstre du combat.
 * - `'doubtful'` : au moins un monstre du combat a une table de drop connue, mais aucun homonyme de
 *   cet objet n'y figure — l'objet ne provient probablement pas de ces monstres (autre source :
 *   ramassage au sol, prime de challenge...). Jamais utilisé pour EXCLURE la ligne, seulement pour
 *   signaler un doute visuel (voir loot-list.component) — le référentiel n'est pas exhaustif.
 * - `'unknown'` : aucun monstre du combat n'a de table de drop connue à ce jour (~127 monstres sur
 *   855, voir server/db/schema.ts) — pas assez de données pour juger, à ne surtout pas confondre
 *   avec `'doubtful'` (qui, lui, a des données à charge). Valeur par défaut/de repli, y compris pour
 *   tout butin resté hors combat (`fightId === null`, jamais passé par cette résolution).
 * Une correction manuelle d'objet (ItemPickerService) force toujours `'confirmed'` : l'utilisateur a
 * lui-même tranché, jamais le contredire après coup par un badge de doute.
 */
export type LootConfidence = 'confirmed' | 'doubtful' | 'unknown';

/** Un objet ramassé pendant le combat : `id` est le gfxId de l'objet (référentiel `wakfu-items.data`), `0` si inconnu.
 * `catalogId` est l'id Ankama (résolution non ambiguë par id, à préférer à `name` seul — voir
 * CatalogService.findWakfuItemEntry, ambigu en cas d'homonymes de rareté différente), `null` si non
 * résolu ou pas encore corrigé manuellement (voir ItemPickerService). Ne pas confondre les deux ids :
 * `id` sert uniquement à l'icône, `catalogId` à l'identité/la correction/l'envoi au compte. */
export interface FightLoot {
  name: string;
  id: number;
  catalogId: number | null;
  quantity: number;
  confidence: LootConfidence;
}

/** XP gagnée par un personnage pendant le combat. */
export interface FightExpGain {
  name: string;
  quantity: number;
}

/**
 * Représentation d'un combat identifié par son `fightId` (log Wakfu), depuis
 * "CREATION DU COMBAT" (première jointure) jusqu'à "[FIGHT] End fight with
 * id X". Une instance par `fightId` permet de garder plusieurs combats
 * concurrents (multi-compte) totalement isolés les uns des autres — voir
 * StatsStoreService, qui indexe les combats en cours par `id` plutôt que de
 * garder un unique état global (ancien bug : le démarrage d'un second combat
 * écrasait la progression du premier, encore en cours).
 */
export class Fight {
  readonly id: number;
  startDate: Date;
  endDate: Date | null = null;
  turnCount = 1;
  readonly allies: FightAlly[] = [];
  readonly enemies: FightEnemy[] = [];
  readonly loots: FightLoot[] = [];
  readonly exp: FightExpGain[] = [];
  /** Kamas gagnés pendant le combat (voir StatsStoreService.registerFightKama) — affichés dans la
   * ligne de butin (FightRecord.kamas), en plus de `loots` ci-dessus. */
  kamas = 0;
  /** Nombre de challenges réussis/échoués annoncés pendant ce combat (voir
   * StatsStoreService.pendingFightChallengesPassed/Failed, alimentés comme `kamas` ci-dessus).
   * Sert de base aux statistiques long terme (fights.challengesPassed/Failed côté serveur) — pas
   * seulement à l'affichage en session (voir StatsStoreService.challengesPassed/Failed, compteurs
   * de session distincts, jamais remplacés par ceux-ci). */
  challengesPassed = 0;
  challengesFailed = 0;

  constructor(id: number, startDate: Date) {
    this.id = id;
    this.startDate = startDate;
  }
}
