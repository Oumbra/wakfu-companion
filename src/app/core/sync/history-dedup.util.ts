import type {
  FightRecord,
  PactExtractionRecord,
  PurchaseRecord,
  TradeRecord,
} from '../services/stats-store.service';

/**
 * Clés de rapprochement session/compte (lot "historique fusionné") — permettent de reconnaître
 * qu'un événement de la session en cours est le MÊME que celui déjà archivé sur le compte, sans
 * hachage asynchrone (voir `client-key.util.ts`/`history-event.model.ts` pour la clé d'ENVOI, un
 * problème différent). Volontairement PROCHES de `fightSignature`/`purchaseSignature`/
 * `tradeSignature` (history-event.model.ts) mais pas identiques : ces clés d'affichage doivent être
 * calculables aussi bien depuis un `FightRecord` de session QUE depuis un `FightRecord` reconstruit
 * à partir de la réponse d'archive (voir `history-archive.service.ts`, `toFightRecord`) — laquelle
 * ne renvoie jamais le `fightId` d'origine (absent de `FightPayload`), donc une clé qui en
 * dépendrait ne matcherait jamais rien côté archive.
 *
 * Limite assumée, identique à celle documentée pour `fightSignature` : deux combats réellement
 * distincts, à la même seconde du log, avec exactement les mêmes participants et le même résultat,
 * seraient reconnus comme un seul. Invraisemblable en pratique.
 */

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function fightDedupKey(record: Pick<FightRecord, 'time' | 'result' | 'rows'>): string {
  const participants = record.rows
    .map((row) => `${normalize(row.name)}#${row.instanceIndex}`)
    .sort()
    .join(',');
  return `${record.time}|${record.result}|${participants}`;
}

export function purchaseDedupKey(
  record: Pick<PurchaseRecord, 'time' | 'item' | 'quantity' | 'totalCost'>,
): string {
  return `${record.time}|${normalize(record.item)}|${record.quantity}|${record.totalCost}`;
}

/** Miroir de purchaseDedupKey/tradeDedupKey, pour une extraction de pacte — pas de coût (voir
 * PactExtractionRecord), juste l'heure et les objets/quantités triés. */
export function pactExtractionDedupKey(
  record: Pick<PactExtractionRecord, 'time' | 'items'>,
): string {
  const items = record.items
    .map((item) => `${normalize(item.name)}x${item.quantity}`)
    .sort()
    .join(',');
  return `${record.time}|${items}`;
}

export function tradeDedupKey(
  record: Pick<
    TradeRecord,
    'time' | 'characterName' | 'selfName' | 'kamasAcquired' | 'kamasGiven' | 'acquired' | 'given'
  >,
): string {
  const items = [
    ...record.acquired.map((item) => `acquired:${normalize(item.name)}x${item.quantity}`),
    ...record.given.map((item) => `given:${normalize(item.name)}x${item.quantity}`),
  ]
    .sort()
    .join(',');
  return [
    record.time,
    normalize(record.characterName),
    normalize(record.selfName),
    record.kamasAcquired,
    record.kamasGiven,
    items,
  ].join('|');
}
