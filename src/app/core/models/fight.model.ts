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

/** Un objet ramassé pendant le combat : `id` est le gfxId de l'objet (référentiel `wakfu-items.data`), `0` si inconnu. */
export interface FightLoot {
  name: string;
  id: number;
  quantity: number;
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

  constructor(id: number, startDate: Date) {
    this.id = id;
    this.startDate = startDate;
  }
}
