/**
 * Validation pure des lots d'historique (lot 8, prompt 8.1) — combats, achats,
 * échanges.
 *
 * Isolée des routes Cloudflare pour la même raison que `server/auth/flow.ts` et
 * `server/settings/merge.ts` : les décisions vivent ici, et elles doivent être
 * testables sans base ni runtime Workers (`server/history/parse.spec.ts`).
 *
 * Le contrat est volontairement strict — un lot qui contient une entrée
 * invalide est refusé **en entier** (400), jamais partiellement ingéré : ces
 * charges utiles sont produites par un seul émetteur (la file de
 * synchronisation du client), une entrée mal formée y signale un bug, pas une
 * saisie utilisateur à rattraper. C'est l'inverse du choix fait pour
 * `/prices/ingest`, où un id inconnu isolé ne doit pas faire perdre tout le
 * scan du jour d'un skill externe.
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Nombre maximal d'entrées par requête. La file cliente découpe elle-même ses
 * envois (voir `SYNC_BATCH_SIZE` dans `core/sync/sync-queue.service.ts`) ; cette
 * borne est le garde-fou serveur correspondant, dimensionné pour rester très
 * loin de la limite de 10 ms CPU par requête du plan gratuit Cloudflare.
 */
export const MAX_HISTORY_BATCH = 100;

/** Bornes de forme : au-delà, la charge utile ne vient plus d'un log Wakfu. */
const MAX_NAME_LENGTH = 200;
const MAX_PARTICIPANTS_PER_FIGHT = 64;
const MAX_ITEMS_PER_TRADE = 128;
/** Sorts distincts ventilés pour une même instance de combattant, et objets ramassés dans un même combat. */
const MAX_SPELLS_PER_PARTICIPANT = 64;
const MAX_LOOT_PER_FIGHT = 128;
/** `clientKey` est un SHA-256 en hexadécimal minuscule (voir core/sync/client-key.util.ts). */
const CLIENT_KEY_PATTERN = /^[0-9a-f]{64}$/;

/** Ventilation des dégâts d'un sort, par élément — miroir de `SpellBreakdownRow` côté client. */
export interface FightSpellInput {
  spell: string;
  total: number;
  byElement: Record<string, number>;
}

export interface FightParticipantInput {
  side: 'ally' | 'enemy';
  name: string;
  /** Id Ankama du monstre (côté 'enemy' uniquement), `null` sinon — miroir de `loot.itemId`. */
  monsterId: number | null;
  instanceIndex: number;
  className: string | null;
  damage: number;
  defeated: boolean;
  spells: FightSpellInput[];
  /** XP gagnée par ce combattant sur ce combat (voir `fight_participants.xpGained`). */
  xpGained: number;
}

/** `itemId`/`itemName` mutuellement exclusifs — voir `parseItemIdentity` et `server/db/schema.ts`
 * (`fightLoot`, même invariant sur les 3 tables d'historique). `lineIndex` : position du butin dans
 * le lot envoyé, attribuée ici plutôt que fournie par le client — remplace `item_name` (peut être
 * `NULL`) dans la clé primaire `fight_loot`, même principe que `TradeItemInput.lineIndex`. */
export interface FightLootInput {
  lineIndex: number;
  itemId: number | null;
  itemName: string | null;
  quantity: number;
}

export interface FightInput {
  clientKey: string;
  startedAt: Date;
  durationMs: number | null;
  won: boolean | null;
  turns: number | null;
  totalDamage: number | null;
  xpGained: number | null;
  kamasGained: number | null;
  gameServer: string | null;
  participants: FightParticipantInput[];
  loot: FightLootInput[];
}

export interface PurchaseInput {
  clientKey: string;
  itemId: number | null;
  itemName: string | null;
  quantity: number;
  totalCost: number;
  occurredAt: Date;
  gameServer: string | null;
}

export interface TradeItemInput {
  direction: 'acquired' | 'given';
  lineIndex: number;
  itemId: number | null;
  itemName: string | null;
  quantity: number;
}

export interface TradeInput {
  clientKey: string;
  peerName: string;
  selfName: string;
  occurredAt: Date;
  kamasAcquired: number;
  kamasGiven: number;
  gameServer: string | null;
  items: TradeItemInput[];
}

function asRecord(raw: unknown, label: string): ParseResult<Record<string, unknown>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `${label} : objet attendu` };
  }
  return { ok: true, value: raw as Record<string, unknown> };
}

function parseClientKey(raw: unknown): ParseResult<string> {
  if (typeof raw !== 'string' || !CLIENT_KEY_PATTERN.test(raw)) {
    return { ok: false, error: 'clientKey invalide (sha256 hexadécimal attendu)' };
  }
  return { ok: true, value: raw };
}

function parseDate(raw: unknown, field: string): ParseResult<Date> {
  if (typeof raw !== 'string') return { ok: false, error: `${field} manquant` };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { ok: false, error: `${field} invalide : ${raw}` };
  return { ok: true, value: parsed };
}

function parseText(raw: unknown, field: string): ParseResult<string> {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, error: `${field} manquant` };
  if (raw.length > MAX_NAME_LENGTH) return { ok: false, error: `${field} trop long` };
  return { ok: true, value: raw };
}

/** Entier fini et positif ou nul — `null`/absent accepté seulement si `optional`. */
function parseCount(raw: unknown, field: string, optional = false): ParseResult<number | null> {
  if (raw === null || raw === undefined) {
    return optional ? { ok: true, value: null } : { ok: false, error: `${field} manquant` };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0) {
    return { ok: false, error: `${field} invalide : ${String(raw)}` };
  }
  return { ok: true, value: raw };
}

/**
 * `itemId`/`itemName` : mutuellement exclusifs (voir `server/db/schema.ts`, `fightLoot`/`purchases`/
 * `tradeItems`) — id résolu ⇒ nom `null` (redondant, résolu à l'affichage via le catalogue) ;
 * sinon nom requis (seule donnée qui identifie encore la ligne). Invariant renforcé ICI plutôt que
 * fait confiance côté client : un client qui enverrait les deux, ou l'ancien format `itemName`
 * toujours renseigné, ne doit ni faire échouer la requête ni stocker une redondance.
 */
function parseItemIdentity(
  itemIdRaw: unknown,
  itemNameRaw: unknown,
  field: string,
): ParseResult<{ itemId: number | null; itemName: string | null }> {
  const itemId = parseCount(itemIdRaw, `${field}.itemId`, true);
  if (!itemId.ok) return itemId;
  if (itemId.value !== null) return { ok: true, value: { itemId: itemId.value, itemName: null } };

  const itemName = parseText(itemNameRaw, `${field}.itemName`);
  if (!itemName.ok) return itemName;
  return { ok: true, value: { itemId: null, itemName: itemName.value } };
}

function parseFlag(raw: unknown, field: string): ParseResult<boolean | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'boolean') return { ok: false, error: `${field} invalide` };
  return { ok: true, value: raw };
}

/**
 * Le serveur de jeu est **toujours facultatif** (prompt 8.1 point 4) : sans
 * serveur résolu, l'événement est enregistré quand même, le champ reste vide.
 * Aucun repli inventé ici — même règle qu'au lot 7 (voir server/README.md).
 */
function parseGameServer(raw: unknown): ParseResult<string | null> {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string' || raw.length > MAX_NAME_LENGTH) {
    return { ok: false, error: 'gameServer invalide' };
  }
  return { ok: true, value: raw };
}

/**
 * Enveloppe commune `{ entries: [...] }`, bornée à `MAX_HISTORY_BATCH`.
 * Les doublons de `clientKey` **au sein d'un même lot** sont refusés : ils
 * feraient échouer l'`INSERT ... ON CONFLICT` de Postgres (« ON CONFLICT DO
 * UPDATE command cannot affect row a second time » sur un upsert, et une
 * insertion silencieusement partielle sinon) — mieux vaut le dire franchement
 * que de laisser passer une charge utile que la file cliente n'aurait jamais dû
 * produire.
 */
function parseBatch<T>(
  body: unknown,
  parseEntry: (raw: Record<string, unknown>) => ParseResult<T>,
  keyOf: (value: T) => string,
): ParseResult<T[]> {
  const entries = (body as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) return { ok: false, error: 'champ "entries" manquant ou invalide' };
  if (entries.length > MAX_HISTORY_BATCH) {
    return { ok: false, error: `lot trop volumineux (max ${MAX_HISTORY_BATCH})` };
  }

  const values: T[] = [];
  const seen = new Set<string>();
  for (const raw of entries) {
    const record = asRecord(raw, 'entrée');
    if (!record.ok) return record;
    const parsed = parseEntry(record.value);
    if (!parsed.ok) return parsed;
    const key = keyOf(parsed.value);
    if (seen.has(key)) return { ok: false, error: `clientKey en double dans le lot : ${key}` };
    seen.add(key);
    values.push(parsed.value);
  }
  return { ok: true, value: values };
}

/**
 * Ventilation d'un sort. `byElement` est stocké en `jsonb` : ses clés sont les
 * éléments Wakfu (`Feu`, `Eau`, `Terre`...) définis côté client
 * (`DamageElement`), volontairement pas ré-énumérés ici — un élément ajouté par
 * une future extension du jeu ne doit pas faire rejeter tout un historique. Les
 * valeurs, elles, sont bornées comme partout ailleurs.
 */
function parseSpell(raw: unknown): ParseResult<FightSpellInput> {
  const record = asRecord(raw, 'sort');
  if (!record.ok) return record;
  const entry = record.value;

  const spell = parseText(entry['spell'], 'spells.spell');
  if (!spell.ok) return spell;
  const total = parseCount(entry['total'] ?? 0, 'spells.total');
  if (!total.ok) return total;

  const rawByElement = entry['byElement'] ?? {};
  if (typeof rawByElement !== 'object' || rawByElement === null || Array.isArray(rawByElement)) {
    return { ok: false, error: 'spells.byElement invalide' };
  }
  const byElement: Record<string, number> = {};
  for (const [element, amount] of Object.entries(rawByElement as Record<string, unknown>)) {
    if (element.length === 0 || element.length > MAX_NAME_LENGTH) {
      return { ok: false, error: 'spells.byElement : élément invalide' };
    }
    const parsed = parseCount(amount, `spells.byElement.${element}`);
    if (!parsed.ok) return parsed;
    byElement[element] = parsed.value ?? 0;
  }

  return { ok: true, value: { spell: spell.value, total: total.value ?? 0, byElement } };
}

function parseLootRow(raw: unknown, lineIndex: number): ParseResult<FightLootInput> {
  const record = asRecord(raw, 'butin');
  if (!record.ok) return record;
  const entry = record.value;

  const identity = parseItemIdentity(entry['itemId'], entry['itemName'], 'loot');
  if (!identity.ok) return identity;
  const quantity = parseCount(entry['quantity'], 'loot.quantity');
  if (!quantity.ok) return quantity;

  return {
    ok: true,
    value: { lineIndex, ...identity.value, quantity: quantity.value ?? 0 },
  };
}

function parseParticipant(raw: unknown): ParseResult<FightParticipantInput> {
  const record = asRecord(raw, 'participant');
  if (!record.ok) return record;
  const entry = record.value;

  if (entry['side'] !== 'ally' && entry['side'] !== 'enemy') {
    return { ok: false, error: 'side invalide (ally|enemy attendu)' };
  }
  const name = parseText(entry['name'], 'participant.name');
  if (!name.ok) return name;
  const monsterId = parseCount(entry['monsterId'], 'participant.monsterId', true);
  if (!monsterId.ok) return monsterId;
  const instanceIndex = parseCount(entry['instanceIndex'] ?? 1, 'participant.instanceIndex');
  if (!instanceIndex.ok) return instanceIndex;
  const damage = parseCount(entry['damage'] ?? 0, 'participant.damage');
  if (!damage.ok) return damage;
  const xpGained = parseCount(entry['xpGained'] ?? 0, 'participant.xpGained');
  if (!xpGained.ok) return xpGained;
  const className = entry['className'];
  if (className !== null && className !== undefined && typeof className !== 'string') {
    return { ok: false, error: 'participant.className invalide' };
  }

  const rawSpells = entry['spells'] ?? [];
  if (!Array.isArray(rawSpells)) return { ok: false, error: 'participant.spells invalide' };
  if (rawSpells.length > MAX_SPELLS_PER_PARTICIPANT) {
    return { ok: false, error: `trop de sorts (max ${MAX_SPELLS_PER_PARTICIPANT})` };
  }
  const spells: FightSpellInput[] = [];
  const seenSpells = new Set<string>();
  for (const rawSpell of rawSpells) {
    const parsed = parseSpell(rawSpell);
    if (!parsed.ok) return parsed;
    // Le client agrège déjà les dégâts par sort : deux entrées du même nom
    // signaleraient une ventilation incohérente, pas deux lancers distincts.
    if (seenSpells.has(parsed.value.spell)) {
      return { ok: false, error: `sort en double : ${parsed.value.spell}` };
    }
    seenSpells.add(parsed.value.spell);
    spells.push(parsed.value);
  }

  return {
    ok: true,
    value: {
      side: entry['side'],
      name: name.value,
      monsterId: monsterId.value,
      instanceIndex: instanceIndex.value ?? 1,
      className: typeof className === 'string' ? className.slice(0, MAX_NAME_LENGTH) : null,
      damage: damage.value ?? 0,
      defeated: entry['defeated'] === true,
      spells,
      xpGained: xpGained.value ?? 0,
    },
  };
}

export function parseFightsBody(body: unknown): ParseResult<FightInput[]> {
  return parseBatch(
    body,
    (entry) => {
      const clientKey = parseClientKey(entry['clientKey']);
      if (!clientKey.ok) return clientKey;
      const startedAt = parseDate(entry['startedAt'], 'startedAt');
      if (!startedAt.ok) return startedAt;
      const durationMs = parseCount(entry['durationMs'], 'durationMs', true);
      if (!durationMs.ok) return durationMs;
      const turns = parseCount(entry['turns'], 'turns', true);
      if (!turns.ok) return turns;
      const totalDamage = parseCount(entry['totalDamage'], 'totalDamage', true);
      if (!totalDamage.ok) return totalDamage;
      const xpGained = parseCount(entry['xpGained'], 'xpGained', true);
      if (!xpGained.ok) return xpGained;
      const kamasGained = parseCount(entry['kamasGained'], 'kamasGained', true);
      if (!kamasGained.ok) return kamasGained;
      const won = parseFlag(entry['won'], 'won');
      if (!won.ok) return won;
      const gameServer = parseGameServer(entry['gameServer']);
      if (!gameServer.ok) return gameServer;

      const rawParticipants = entry['participants'] ?? [];
      if (!Array.isArray(rawParticipants)) return { ok: false, error: 'participants invalide' };
      if (rawParticipants.length > MAX_PARTICIPANTS_PER_FIGHT) {
        return { ok: false, error: `trop de participants (max ${MAX_PARTICIPANTS_PER_FIGHT})` };
      }
      const participants: FightParticipantInput[] = [];
      // La clé primaire de `fight_participants` est (fight_id, side, name,
      // instance_index) : deux lignes identiques dans le même combat feraient
      // échouer l'insertion entière, on les refuse ici plutôt qu'en base.
      const seenSeats = new Set<string>();
      for (const rawParticipant of rawParticipants) {
        const parsed = parseParticipant(rawParticipant);
        if (!parsed.ok) return parsed;
        const seat = `${parsed.value.side}|${parsed.value.name}|${parsed.value.instanceIndex}`;
        if (seenSeats.has(seat)) return { ok: false, error: `participant en double : ${seat}` };
        seenSeats.add(seat);
        participants.push(parsed.value);
      }

      const rawLoot = entry['loot'] ?? [];
      if (!Array.isArray(rawLoot)) return { ok: false, error: 'loot invalide' };
      if (rawLoot.length > MAX_LOOT_PER_FIGHT) {
        return { ok: false, error: `trop d'objets ramassés (max ${MAX_LOOT_PER_FIGHT})` };
      }
      const loot: FightLootInput[] = [];
      // `lineIndex` = position dans le lot envoyé, attribuée ici (voir FightLootInput) — remplace
      // `item_name` (peut être `NULL` désormais) comme clé primaire `(fight_id, line_index)`.
      // Déterministe pour un même contenu rejoué (`registerLoot` construit ce tableau dans un ordre
      // stable), donc un rejeu du même log ne crée jamais de doublon.
      for (let i = 0; i < rawLoot.length; i++) {
        const parsed = parseLootRow(rawLoot[i], i);
        if (!parsed.ok) return parsed;
        loot.push(parsed.value);
      }

      return {
        ok: true,
        value: {
          clientKey: clientKey.value,
          startedAt: startedAt.value,
          durationMs: durationMs.value,
          won: won.value,
          turns: turns.value,
          totalDamage: totalDamage.value,
          xpGained: xpGained.value,
          kamasGained: kamasGained.value,
          gameServer: gameServer.value,
          participants,
          loot,
        },
      };
    },
    (fight) => fight.clientKey,
  );
}

export function parsePurchasesBody(body: unknown): ParseResult<PurchaseInput[]> {
  return parseBatch(
    body,
    (entry) => {
      const clientKey = parseClientKey(entry['clientKey']);
      if (!clientKey.ok) return clientKey;
      const identity = parseItemIdentity(entry['itemId'], entry['itemName'], 'purchase');
      if (!identity.ok) return identity;
      const quantity = parseCount(entry['quantity'], 'quantity');
      if (!quantity.ok) return quantity;
      const totalCost = parseCount(entry['totalCost'], 'totalCost');
      if (!totalCost.ok) return totalCost;
      const occurredAt = parseDate(entry['occurredAt'], 'occurredAt');
      if (!occurredAt.ok) return occurredAt;
      const gameServer = parseGameServer(entry['gameServer']);
      if (!gameServer.ok) return gameServer;

      return {
        ok: true,
        value: {
          clientKey: clientKey.value,
          ...identity.value,
          quantity: quantity.value ?? 0,
          totalCost: totalCost.value ?? 0,
          occurredAt: occurredAt.value,
          gameServer: gameServer.value,
        },
      };
    },
    (purchase) => purchase.clientKey,
  );
}

export function parseTradesBody(body: unknown): ParseResult<TradeInput[]> {
  return parseBatch(
    body,
    (entry) => {
      const clientKey = parseClientKey(entry['clientKey']);
      if (!clientKey.ok) return clientKey;
      const peerName = parseText(entry['peerName'], 'peerName');
      if (!peerName.ok) return peerName;
      const selfName = parseText(entry['selfName'], 'selfName');
      if (!selfName.ok) return selfName;
      const occurredAt = parseDate(entry['occurredAt'], 'occurredAt');
      if (!occurredAt.ok) return occurredAt;
      const kamasAcquired = parseCount(entry['kamasAcquired'] ?? 0, 'kamasAcquired');
      if (!kamasAcquired.ok) return kamasAcquired;
      const kamasGiven = parseCount(entry['kamasGiven'] ?? 0, 'kamasGiven');
      if (!kamasGiven.ok) return kamasGiven;
      const gameServer = parseGameServer(entry['gameServer']);
      if (!gameServer.ok) return gameServer;

      const rawItems = entry['items'] ?? [];
      if (!Array.isArray(rawItems)) return { ok: false, error: 'items invalide' };
      if (rawItems.length > MAX_ITEMS_PER_TRADE) {
        return { ok: false, error: `trop d'objets échangés (max ${MAX_ITEMS_PER_TRADE})` };
      }
      const items: TradeItemInput[] = [];
      // `lineIndex` est attribué ici, par direction, plutôt que fourni par le
      // client : c'est un simple rang de ligne (clé primaire de `trade_items`),
      // pas une donnée métier — et il doit rester déterministe pour le même
      // contenu, sans quoi un rejeu recréerait des lignes filles en double.
      const nextIndex = { acquired: 0, given: 0 };
      for (const rawItem of rawItems) {
        const record = asRecord(rawItem, 'objet échangé');
        if (!record.ok) return record;
        const item = record.value;
        if (item['direction'] !== 'acquired' && item['direction'] !== 'given') {
          return { ok: false, error: 'direction invalide (acquired|given attendu)' };
        }
        const identity = parseItemIdentity(item['itemId'], item['itemName'], 'items');
        if (!identity.ok) return identity;
        const quantity = parseCount(item['quantity'], 'items.quantity');
        if (!quantity.ok) return quantity;

        items.push({
          direction: item['direction'],
          lineIndex: nextIndex[item['direction']]++,
          ...identity.value,
          quantity: quantity.value ?? 0,
        });
      }

      return {
        ok: true,
        value: {
          clientKey: clientKey.value,
          peerName: peerName.value,
          selfName: selfName.value,
          occurredAt: occurredAt.value,
          kamasAcquired: kamasAcquired.value ?? 0,
          kamasGiven: kamasGiven.value ?? 0,
          gameServer: gameServer.value,
          items,
        },
      };
    },
    (trade) => trade.clientKey,
  );
}

/** Bornes de la lecture paginée (`GET /api/v1/history/*`). */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface PageQuery {
  limit: number;
  /**
   * Curseur d'ancienneté : ne renvoyer que les entrées strictement antérieures
   * à cette date. Pagination par valeur (pas `OFFSET`) — un historique s'écrit
   * pendant qu'on le feuillette, un offset sauterait ou répéterait des lignes
   * au fil des insertions.
   */
  before: Date | null;
}

export function parsePageQuery(params: URLSearchParams): ParseResult<PageQuery> {
  const rawLimit = params.get('limit');
  let limit = DEFAULT_PAGE_SIZE;
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_PAGE_SIZE) {
      return { ok: false, error: `limit invalide (1..${MAX_PAGE_SIZE})` };
    }
    limit = parsed;
  }

  const rawBefore = params.get('before');
  if (rawBefore === null) return { ok: true, value: { limit, before: null } };
  const before = new Date(rawBefore);
  if (Number.isNaN(before.getTime())) return { ok: false, error: `before invalide : ${rawBefore}` };
  return { ok: true, value: { limit, before } };
}
