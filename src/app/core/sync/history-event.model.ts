/**
 * Événements d'historique envoyés au compte (lot 8, prompt 8.1) et, surtout,
 * **leur signature de contenu** — la pièce la plus délicate de tout ce lot.
 *
 * ## Pourquoi une signature dérivée du contenu
 *
 * Principe d'architecture n°2 (CLAUDE.md) : toute (re)connexion au fichier de
 * log le relit depuis le début et reconstruit l'historique complet. Les
 * identifiants côté client (`nextPurchaseId`, `nextTradeId`) sont des compteurs
 * de session remis à zéro à chaque reconstruction, donc inutilisables comme
 * clés : sans précaution, chaque reconnexion réenverrait tout et créerait des
 * doublons **persistés côté serveur**, qu'un simple F5 ne réparerait pas.
 *
 * La signature identifie donc l'événement par ce qu'il EST, de façon
 * déterministe. `client-key.util.ts` en dérive `sha256(uid|type|heure|signature)`,
 * qui rencontre côté serveur un `UNIQUE (user_id, client_key)` et un
 * `INSERT ... ON CONFLICT DO NOTHING`.
 *
 * ## Deux règles de composition, et leurs raisons
 *
 * 1. **L'heure du log, jamais la date système.** `StatsStoreService`
 *    reconstitue un horodatage complet en collant l'heure du log
 *    (`HH:MM:SS,mmm`, seule information que Wakfu écrit) à la date du jour où
 *    la lecture a lieu. Relire demain le même fichier produirait donc un
 *    horodatage différent pour le même événement — et un doublon, précisément
 *    ce que ce lot combat. La signature n'utilise que l'heure brute du log.
 *
 *    Limite assumée, à connaître : deux événements réellement distincts,
 *    survenus à la même milliseconde de la journée et portant exactement le
 *    même contenu (mêmes participants, même objet/quantité/prix...), seraient
 *    considérés comme un seul. Le cas est invraisemblable en pratique, et c'est
 *    le prix à payer pour qu'un fichier relu un autre jour reste idempotent —
 *    le vrai risque, lui, est quotidien.
 *
 * 2. **Aucune valeur révisable.** Les dégâts d'un combat n'entrent PAS dans sa
 *    signature (le plan disait déjà `fightId|participants triés`) : une
 *    réattribution manuelle (`reassignSpell`) les modifie après coup, ce qui
 *    changerait la clé et créerait une seconde ligne pour le même combat.
 *
 *    Ce n'est pas pour autant un journal figé : la clé identifie le combat, et
 *    son **détail** (dégâts et ventilation par sort de chaque instance) est
 *    rafraîchi à chaque envoi côté serveur (`ON CONFLICT DO UPDATE` sur
 *    `fight_participants`). `StatsStoreService` remet donc le combat en file
 *    après chaque réattribution, et la correction remonte au compte sans jamais
 *    créer de doublon.
 */

export type HistoryEventKind = 'fight' | 'purchase' | 'trade';

/** Charges utiles, en miroir exact de ce qu'attendent les endpoints `/api/v1/history/*`. */

/** Ventilation des dégâts d'un sort — miroir de `SpellBreakdownRow` (stats-store). */
export interface FightSpellPayload {
  spell: string;
  total: number;
  byElement: Record<string, number>;
}

export interface FightParticipantPayload {
  side: 'ally' | 'enemy';
  name: string;
  instanceIndex: number;
  className: string | null;
  damage: number;
  defeated: boolean;
  spells: FightSpellPayload[];
  /** XP gagnée par ce combattant sur ce combat (0 pour les ennemis). */
  xpGained: number;
}

export interface FightLootPayload {
  itemId: number | null;
  itemName: string;
  quantity: number;
}

export interface FightPayload {
  startedAt: string;
  durationMs: number | null;
  won: boolean;
  turns: number;
  totalDamage: number;
  xpGained: number;
  kamasGained: number | null;
  gameServer: string | null;
  participants: FightParticipantPayload[];
  loot: FightLootPayload[];
}

export interface PurchasePayload {
  itemId: number | null;
  itemName: string;
  quantity: number;
  totalCost: number;
  occurredAt: string;
  gameServer: string | null;
}

export interface TradeItemPayload {
  direction: 'acquired' | 'given';
  itemId: number | null;
  itemName: string;
  quantity: number;
}

export interface TradePayload {
  peerName: string;
  selfName: string;
  occurredAt: string;
  kamasAcquired: number;
  kamasGiven: number;
  gameServer: string | null;
  items: TradeItemPayload[];
}

export type HistoryPayload = FightPayload | PurchasePayload | TradePayload;

/** Une entrée de la file de synchronisation, telle que persistée en IndexedDB. */
export interface HistoryEvent {
  /** `${kind}:${signature}` — clé primaire du magasin, donc dédoublonnage naturel dans la file elle-même. */
  id: string;
  kind: HistoryEventKind;
  /** Signature de contenu (voir en-tête) — sert aussi à reconnaître localement un événement déjà archivé. */
  signature: string;
  payload: HistoryPayload;
  /** Date de mise en file (diagnostic et purge des entrées trop anciennes). */
  queuedAt: number;
  /** Nombre d'envois ayant échoué pour cette entrée — voir `SyncQueueService`. */
  attempts: number;
}

/** Chemins d'API par type d'événement. */
export const HISTORY_ENDPOINTS: Record<HistoryEventKind, string> = {
  fight: '/history/fights',
  purchase: '/history/purchases',
  trade: '/history/trades',
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Signature d'un combat : heure de fin, identifiant de combat du log, résultat
 * et **noms** des participants triés — jamais leurs dégâts (voir règle n°2).
 *
 * `fightId` vient du log Wakfu lui-même (`[_FL_] fightId=…`), pas d'un compteur
 * de l'application : il est stable d'une relecture à l'autre du même fichier.
 */
export function fightSignature(input: {
  time: string;
  fightId: number;
  result: 'won' | 'lost';
  participants: readonly { name: string; instanceIndex: number }[];
}): string {
  const participants = input.participants
    .map((p) => `${normalize(p.name)}#${p.instanceIndex}`)
    .sort()
    .join(',');
  return `${input.time}|${input.fightId}|${input.result}|${participants}`;
}

/** Signature d'un achat : `item|quantité|coût`, comme prévu au §11 du plan. */
export function purchaseSignature(input: {
  time: string;
  item: string;
  quantity: number;
  totalCost: number;
}): string {
  return `${input.time}|${normalize(input.item)}|${input.quantity}|${input.totalCost}`;
}

/** Signature d'un échange : les deux personnages, les kamas, et les objets des deux côtés triés. */
export function tradeSignature(input: {
  time: string;
  peerName: string;
  selfName: string;
  kamasAcquired: number;
  kamasGiven: number;
  items: readonly { direction: 'acquired' | 'given'; name: string; quantity: number }[];
}): string {
  const items = input.items
    .map((item) => `${item.direction}:${normalize(item.name)}x${item.quantity}`)
    .sort()
    .join(',');
  return [
    input.time,
    normalize(input.peerName),
    normalize(input.selfName),
    input.kamasAcquired,
    input.kamasGiven,
    items,
  ].join('|');
}
