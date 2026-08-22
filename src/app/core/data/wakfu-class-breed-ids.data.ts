/**
 * Id de classe joueur ("breed") émis par la ligne de combat `[_FL_] fightId=...
 * Nom breed : B [id] isControlledByAI=... obstacleId : O join the fight`
 * (voir `LogParser.parseFighterJoin`) → clé de classe interne (voir
 * `class-names.data.ts`/`class-icons.data.ts`).
 *
 * Relevé sur l'encyclopédie officielle Ankama (id de classe standard,
 * indépendant de toute langue). N'est déterministe QUE pour un combattant
 * confirmé allié (`isControlledByAI=false`, voir `EntityClassifierService`) :
 * un monstre peut porter un breed numériquement identique à un id de classe
 * joueur (ex. "Bouftou" = breed 1, collision avec Féca) sans rapport avec sa
 * classe — ne jamais utiliser cette table pour un combattant dont le camp
 * n'est pas déjà confirmé allié par ailleurs.
 *
 * Id 17 volontairement absent (aucune classe jouable ne l'utilise).
 */
export const WAKFU_CLASS_BREED_IDS: Readonly<Record<number, string>> = {
  1: 'feca',
  2: 'osamodas',
  3: 'enutrof',
  4: 'sram',
  5: 'xelor',
  6: 'ecaflip',
  7: 'eniripsa',
  8: 'iop',
  9: 'cra',
  10: 'sadida',
  11: 'sacrier',
  12: 'pandawa',
  13: 'rogue',
  14: 'zobal',
  15: 'ouginak',
  16: 'foggernaut',
  18: 'eliotrope',
  19: 'huppermage',
};
