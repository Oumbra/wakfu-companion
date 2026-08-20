/** Éléments de dégâts reconnus dans les lignes de combat du log Wakfu. */
export type DamageElement =
  'Neutre' | 'Terre' | 'Feu' | 'Eau' | 'Air' | 'Lumière' | 'Stasis' | 'Inconnu';

/** Canaux de chat affichés dans le panneau Chat. */
export type ChatChannelKey =
  'proximite' | 'groupe' | 'guilde' | 'recrutement' | 'commerce' | 'communaute';

export interface ChatChannelInfo {
  key: ChatChannelKey;
  label: string;
}

export interface ChatMessageEntry {
  kind: 'chat';
  time: string;
  channel: ChatChannelKey;
  channelLabel: string;
  author: string;
  message: string;
}

export interface KamaGainEntry {
  kind: 'kama-gain';
  time: string;
  amount: number;
  /** Combat en cours au moment du gain, `null` si hors combat (ex. récupération de kamas à
   * l'Hôtel de vente) — voir LootEntry.fightId, même principe. Sert à StatsStoreService à
   * distinguer un gain de butin de combat d'une récupération de kamas à l'HDV, qui produisent
   * toutes deux la même ligne de log. */
  fightId: number | null;
}

export interface KamaLossEntry {
  kind: 'kama-loss';
  time: string;
  amount: number;
}

export interface XpGainEntry {
  kind: 'xp-gain';
  time: string;
  character: string;
  amount: number;
  /** Combat auquel rattacher ce gain d'XP (voir Fight.exp), `null` si hors combat ou combat non résolu. */
  fightId: number | null;
}

export interface SpellCastEntry {
  kind: 'spell-cast';
  time: string;
  caster: string;
  spell: string;
  critical: boolean;
  /** Combat auquel rattacher ce lancer de sort (voir Fight.turnCount) — seul signal universel
   * (allié comme monstre) disponible pour détecter les changements de tour, `null` si non résolu. */
  fightId: number | null;
}

export interface DamageEntry {
  kind: 'damage';
  time: string;
  target: string;
  attacker: string;
  spell: string;
  element: DamageElement;
  amount: number;
  /** Combat auquel rattacher ce dégât, résolu via l'appartenance de `attacker` à un combat en cours (voir LogParser). */
  fightId: number | null;
}

/** KO d'un combattant, allié ("... est KO !") ou n'importe qui ("... est hors-combat !", diffusé à tous les participants). */
export interface EnemyDefeatedEntry {
  kind: 'enemy-defeated';
  time: string;
  name: string;
  fightId: number | null;
}

export interface CombatDefeatMarkerEntry {
  kind: 'combat-defeat-marker';
  time: string;
  fightId: number | null;
}

export interface CombatStartEntry {
  kind: 'combat-start';
  time: string;
}

export interface CombatEndEntry {
  kind: 'combat-end';
  time: string;
  fightId: number;
  result: 'won' | 'lost';
}

export interface LootEntry {
  kind: 'loot';
  time: string;
  item: string;
  quantity: number;
  /** Combat en cours au moment du ramassage, `null` si hors combat (ex. récolte en extérieur) — dans ce cas l'objet n'alimente aucun Fight.loots. */
  fightId: number | null;
}

export interface ChallengeResultEntry {
  kind: 'challenge-result';
  time: string;
  name: string;
  success: boolean;
}

/**
 * Rejointe d'un combattant au combat ("[_FL_] fightId=... Nom breed : B [id]
 * isControlledByAI=true/false obstacleId : O join the fight..."). Signal fiable
 * et systématique (émis pour CHAQUE combattant de CHAQUE combat) pour distinguer
 * allié (isControlledByAI=false, contrôlé par un vrai joueur) d'ennemi
 * (isControlledByAI=true) — bien plus robuste que les heuristiques par sorts/dégâts
 * quand un monstre est absent de la base statique ou qu'aucun sort n'a été lancé.
 */
export interface FighterJoinedEntry {
  kind: 'fighter-joined';
  time: string;
  fightId: number;
  name: string;
  /** Classe (alliés) ou espèce (ennemis) — voir Fight.allies/enemies. */
  breed: number;
  /** Identifiant du combattant pour cette instance de combat (valeur entre crochets). */
  fighterId: number;
  isControlledByAI: boolean;
}

export interface TradeSide {
  playerName: string;
  items: { name: string; quantity: number }[];
  kamas: number;
}

/** Résumé final d'un échange ("[Trade] le joueur X donne : ... / le joueur Y donne : ..."), les deux côtés étant toujours présents. */
export interface TradeCompletedEntry {
  kind: 'trade-completed';
  time: string;
  sides: [TradeSide, TradeSide];
}

export type LogEntry =
  | ChatMessageEntry
  | KamaGainEntry
  | KamaLossEntry
  | XpGainEntry
  | SpellCastEntry
  | DamageEntry
  | EnemyDefeatedEntry
  | CombatDefeatMarkerEntry
  | CombatStartEntry
  | CombatEndEntry
  | LootEntry
  | ChallengeResultEntry
  | FighterJoinedEntry
  | TradeCompletedEntry;
