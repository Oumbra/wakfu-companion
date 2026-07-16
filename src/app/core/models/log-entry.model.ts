/** Éléments de dégâts reconnus dans les lignes de combat du log Wakfu. */
export type DamageElement =
  | 'Neutre'
  | 'Terre'
  | 'Feu'
  | 'Eau'
  | 'Air'
  | 'Lumière'
  | 'Stasis'
  | 'Inconnu';

/** Canaux de chat affichés dans le panneau Chat. */
export type ChatChannelKey =
  | 'proximite'
  | 'groupe'
  | 'guilde'
  | 'recrutement'
  | 'commerce'
  | 'communaute';

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
}

export interface SpellCastEntry {
  kind: 'spell-cast';
  time: string;
  caster: string;
  spell: string;
  critical: boolean;
}

export interface DamageEntry {
  kind: 'damage';
  time: string;
  target: string;
  attacker: string;
  spell: string;
  element: DamageElement;
  amount: number;
}

export interface EnemyDefeatedEntry {
  kind: 'enemy-defeated';
  time: string;
  name: string;
}

export interface CombatDefeatMarkerEntry {
  kind: 'combat-defeat-marker';
  time: string;
}

export interface CombatStartEntry {
  kind: 'combat-start';
  time: string;
}

export interface CombatEndEntry {
  kind: 'combat-end';
  time: string;
  result: 'won' | 'lost';
}

export interface LootEntry {
  kind: 'loot';
  time: string;
  item: string;
  quantity: number;
}

/** Marqueur fiable de changement de tour ("N secondes reportées pour le tour suivant"), émis une fois par transition. */
export interface TurnMarkerEntry {
  kind: 'turn-marker';
  time: string;
}

export interface ChallengeResultEntry {
  kind: 'challenge-result';
  time: string;
  name: string;
  success: boolean;
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
  | TurnMarkerEntry
  | ChallengeResultEntry;
