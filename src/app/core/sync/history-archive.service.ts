import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';
import { CatalogService } from '../api/catalog.service';
import { I18nService } from '../services/i18n.service';
import {
  StatsStoreService,
  type EntityDamageRow,
  type FightRecord,
  type PurchaseRecord,
  type SpellBreakdownRow,
  type TradeRecord,
} from '../services/stats-store.service';
import { HISTORY_ENDPOINTS, type HistoryEventKind } from './history-event.model';
import { fightDedupKey, purchaseDedupKey, tradeDedupKey } from './history-dedup.util';
import { HistorySyncService } from './history-sync.service';

/** Provenance d'une ligne fusionnée (voir `mergedFights` etc.) — `'session'` dès que l'événement
 * fait partie de la session en cours, MÊME si la ligne réellement affichée vient de la copie
 * archivée (préférée en cas de doublon, voir `merge`) : c'est ce que l'utilisateur attend du
 * regroupement "par localisation" (l'appartenance à la session prime sur l'origine de la copie
 * gardée). `'account'` seulement pour ce qui n'existe QUE dans l'archive du compte. */
export type HistoryOrigin = 'session' | 'account';

/** Taille d'une page de lecture (`GET /api/v1/history/*?limit=`). */
const PAGE_SIZE = 50;

/** Nombre maximal de pages enchaînées par `loadMorePurchasesUntilDayComplete` — garde-fou pur
 * (jamais censé être atteint en pratique, voir sa doc) plutôt qu'une vraie limite métier. */
const MAX_DAY_COMPLETION_PAGES = 40;

/** Début du jour calendaire LOCAL (minuit) contenant `timestampMs` — même découpage que
 * `I18nService.formatRelativeDay` (celui qui pilote le regroupement par jour affiché), reproduit
 * ici en pur pour ne pas faire dépendre ce service d'`I18nService`. */
function localDayStart(timestampMs: number): number {
  const d = new Date(timestampMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

interface FightPage {
  entries: {
    clientKey: string;
    startedAt: string;
    durationMs: number | null;
    won: boolean | null;
    turns: number | null;
    totalDamage: number | null;
    xpGained: number | null;
    kamasGained: number | null;
    gameServer: string | null;
    participants: {
      side: 'ally' | 'enemy';
      name: string;
      instanceIndex: number;
      className: string | null;
      damage: number;
      defeated: boolean;
      spells: { spell: string; total: number; byElement: Record<string, number> }[] | null;
      xpGained: number | null;
    }[];
    loot: { itemId: number | null; itemName: string | null; quantity: number }[];
  }[];
  nextBefore: string | null;
}

interface PurchasePage {
  entries: {
    clientKey: string;
    itemId: number | null;
    itemName: string | null;
    quantity: number;
    totalCost: number;
    occurredAt: string;
    gameServer: string | null;
  }[];
  nextBefore: string | null;
}

interface TradePage {
  entries: {
    clientKey: string;
    peerName: string;
    selfName: string;
    occurredAt: string;
    kamasAcquired: number;
    kamasGiven: number;
    gameServer: string | null;
    acquired: { itemId: number | null; itemName: string | null; quantity: number }[];
    given: { itemId: number | null; itemName: string | null; quantity: number }[];
  }[];
  nextBefore: string | null;
}

/**
 * Lecture de l'historique archivé sur le compte (lot 8, prompt 8.1 — « GET
 * paginés pour l'affichage de l'historique »).
 *
 * ## Fusion session/compte, et pourquoi elle reste approximative par construction
 *
 * La liste de session (`StatsStoreService`) est reconstruite depuis le fichier de log courant et
 * plafonnée à 30 combats ; l'archive du compte, elle, contient tout, y compris ce que la session
 * vient d'envoyer. Les deux sont maintenant fusionnées en continu (`mergedFights`/`mergedPurchases`/
 * `mergedTrades`, chargées dès la connexion — voir `loadAll`) plutôt que basculées manuellement.
 *
 * Le rapprochement d'un doublon (même événement présent des deux côtés) se fait par une clé de
 * CONTENU (`history-dedup.util.ts` : heure de log + résultat/quantité/coût + participants ou
 * objets), pas par la clé SHA-256 d'envoi (`client-key.util.ts`) — celle-ci dépend du `fightId` du
 * log, jamais renvoyé par l'archive (absent de `FightPayload`), et son calcul est de toute façon
 * asynchrone (`crypto.subtle.digest`), inadapté à un `computed()` synchrone recalculé à chaque
 * rendu. La clé de contenu, elle, est pure et bon marché : calculable des deux côtés, à la volée.
 *
 * Limite assumée, identique à celle documentée pour `fightSignature` : deux événements réellement
 * distincts, à la même seconde du log et strictement identiques par ailleurs, seraient vus comme un
 * seul. Invraisemblable en pratique — c'était déjà l'arbitrage retenu pour la déduplication d'envoi.
 *
 * ## Ce que l'archive contient
 *
 * Tout ce que la vue de session affiche d'un combat terminé : participants,
 * dégâts, **ventilation par sort et par élément** (`fight_participants.spells`)
 * et **butin** (`fight_loot`). Ces deux dernières informations ne figuraient pas
 * au schéma du §6 du plan ; elles y ont été ajoutées parce que sans elles un
 * combat archivé perdait l'essentiel de son intérêt.
 *
 * Deux différences subsistent avec la vue de session, faute de données
 * archivées correspondantes : l'XP est un total de combat et non une
 * ventilation par personnage, et les kamas ne sont pas rattachés au combat (le
 * log ne les y relie jamais, voir `KamaGainEntry`).
 */
@Injectable({ providedIn: 'root' })
export class HistoryArchiveService {
  private readonly api = inject(ApiClientService);
  private readonly stats = inject(StatsStoreService);
  private readonly catalog = inject(CatalogService);
  private readonly i18n = inject(I18nService);
  private readonly historySync = inject(HistorySyncService);

  private readonly _fights = signal<readonly FightRecord[]>([]);
  private readonly _purchases = signal<readonly PurchaseRecord[]>([]);
  private readonly _trades = signal<readonly TradeRecord[]>([]);
  private readonly _loading = signal(false);
  private readonly _failed = signal(false);
  /** Curseur de la page suivante par type ; `null` + `loaded` = tout est chargé. */
  private readonly cursors = new Map<HistoryEventKind, string | null>();
  private readonly loaded = new Set<HistoryEventKind>();
  private readonly _exhausted = signal<readonly HistoryEventKind[]>([]);
  /** Source d'id pour un `PurchaseRecord` créé par une scission locale (voir `reassignPurchaseItem`)
   * — jamais renvoyé par le serveur (jusqu'au prochain fetch, qui le remplacera par le vrai
   * `archiveId`), sert uniquement de clé `@for track` stable entre-temps. Très négatif pour ne
   * jamais entrer en collision avec `archiveId(index)` (`-1 - index`, borné par la taille réelle de
   * l'archive chargée). */
  private nextSyntheticId = -1_000_000_000;

  /** Archive brute du compte (sans la session) — encore utile pour `mergedXxx` ci-dessous, plus
   * consommée ailleurs directement (voir `fight-history`/`purchases`/`trades.component.ts`). */
  readonly fights = this._fights.asReadonly();
  readonly purchases = this._purchases.asReadonly();
  readonly trades = this._trades.asReadonly();
  readonly loading = this._loading.asReadonly();
  /** Vrai quand la dernière lecture a échoué (hors ligne, serveur indisponible). */
  readonly failed = this._failed.asReadonly();

  /** Combats de la session en cours + archive du compte, dédoublonnés (voir doc de classe) et triés
   * du plus récent au plus ancien. `origin` reflète l'appartenance à la session (pas la provenance
   * de la copie effectivement affichée) — voir `HistoryOrigin`. */
  readonly mergedFights = computed<readonly (FightRecord & { origin: HistoryOrigin })[]>(() => {
    const sessionRecords = this.stats.fightHistory();
    const sessionKeys = new Set(sessionRecords.map(fightDedupKey));
    const account = this._fights();
    const accountKeys = new Set(account.map(fightDedupKey));
    const sessionOnly = sessionRecords
      .filter((record) => !accountKeys.has(fightDedupKey(record)))
      .map((record) => ({ ...record, origin: 'session' as const }));
    const accountTagged = account.map((record) => ({
      ...record,
      origin: (sessionKeys.has(fightDedupKey(record)) ? 'session' : 'account') as HistoryOrigin,
    }));
    return [...sessionOnly, ...accountTagged].sort((a, b) => b.fullTimestampMs - a.fullTimestampMs);
  });

  readonly mergedPurchases = computed<readonly PurchaseRecord[]>(() => {
    const account = this._purchases();
    const accountKeys = new Set(account.map(purchaseDedupKey));
    const sessionOnly = this.stats
      .purchaseHistory()
      .filter((record) => !accountKeys.has(purchaseDedupKey(record)));
    return [...sessionOnly, ...account].sort((a, b) => b.fullTimestampMs - a.fullTimestampMs);
  });

  readonly mergedTrades = computed<readonly TradeRecord[]>(() => {
    const account = this._trades();
    const accountKeys = new Set(account.map(tradeDedupKey));
    const sessionOnly = this.stats
      .tradeHistory()
      .filter((record) => !accountKeys.has(tradeDedupKey(record)));
    return [...sessionOnly, ...account].sort((a, b) => b.fullTimestampMs - a.fullTimestampMs);
  });

  hasMore(kind: HistoryEventKind): boolean {
    return !this._exhausted().includes(kind);
  }

  /** Charge la première page de chaque type si ce n'est pas déjà fait — appelé dès qu'on sait
   * l'utilisateur connecté (voir `AuthService`), plus au clic sur un bouton (la bascule Session/
   * Compte a disparu, voir doc de classe). Sans effet en mode invité (l'appelant ne l'invoque pas). */
  async loadAll(): Promise<void> {
    await Promise.all(
      (Object.keys(HISTORY_ENDPOINTS) as HistoryEventKind[])
        .filter((kind) => !this.loaded.has(kind))
        .map((kind) =>
          kind === 'purchase' ? this.loadMorePurchasesUntilDayComplete() : this.loadMore(kind),
        ),
    );
  }

  /** Charge la page suivante d'un type. Sans effet si tout est déjà chargé. */
  async loadMore(kind: HistoryEventKind): Promise<void> {
    if (this.loaded.has(kind) && !this.hasMore(kind)) return;
    this._loading.set(true);

    const before = this.cursors.get(kind);
    const query = `?limit=${PAGE_SIZE}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
    const result = await this.api.getJson<FightPage | PurchasePage | TradePage>(
      `${HISTORY_ENDPOINTS[kind]}${query}`,
      { retries: 0 },
    );
    this._loading.set(false);

    if (!result.ok) {
      // Un 401 est déjà traité globalement (retour en mode invité) ; tout autre
      // échec laisse simplement la vue sur ce qui est déjà chargé.
      this._failed.set(true);
      return;
    }
    this._failed.set(false);
    this.loaded.add(kind);
    this.cursors.set(kind, result.data.nextBefore);
    if (result.data.nextBefore === null) {
      this._exhausted.update((list) => (list.includes(kind) ? list : [...list, kind]));
    }

    switch (kind) {
      case 'fight':
        this._fights.update((current) => [
          ...current,
          ...(result.data as FightPage).entries.map((entry, index) =>
            toFightRecord(
              entry,
              current.length + index,
              this.catalog,
              this.i18n,
              this.stats,
              this.historySync,
            ),
          ),
        ]);
        break;
      case 'purchase':
        this._purchases.update((current) => [
          ...current,
          ...(result.data as PurchasePage).entries.map((entry, index) =>
            toPurchaseRecord(
              entry,
              current.length + index,
              this.catalog,
              this.i18n,
              this.stats,
              this.historySync,
            ),
          ),
        ]);
        break;
      case 'trade':
        this._trades.update((current) => [
          ...current,
          ...(result.data as TradePage).entries.map((entry, index) =>
            toTradeRecord(
              entry,
              current.length + index,
              this.catalog,
              this.i18n,
              this.stats,
              this.historySync,
            ),
          ),
        ]);
        break;
    }
  }

  /**
   * Comme `loadMore('purchase')`, mais enchaîne autant de pages supplémentaires que nécessaire
   * pour garantir que le jour calendaire le plus ancien parmi les achats déjà chargés est
   * COMPLET — voir CLAUDE.md ("les données d'historique d'achat doivent toujours être chargées
   * par jour complet"). Sans ce garde-fou, un jour affiché par `PurchasesComponent` (regroupement
   * par jour) pouvait n'être que partiellement chargé (une seule page de `PAGE_SIZE` achats, quel
   * que soit le nombre réel d'achats de ce jour), affichant un total très inférieur à la réalité
   * tant que l'utilisateur ne cliquait pas "Charger plus" assez de fois — bug réel signalé.
   *
   * Un jour n'est prouvé complet qu'en ayant chargé un achat plus ANCIEN que lui : l'API renvoie
   * les pages triées du plus récent au plus ancien sans jamais réordonner, donc dépasser un jour
   * prouve qu'il n'en reste plus rien à charger — ou par épuisement de l'archive
   * (`!hasMore('purchase')`). Bornée par construction : cette méthode ne poursuit que jusqu'à ce
   * premier jour complet, jamais au-delà (pas de préchargement en cascade de tout l'historique du
   * compte à chaque connexion) — `MAX_DAY_COMPLETION_PAGES` est un garde-fou pur en plus (jamais
   * censé être atteint), pas une troncature métier voulue.
   */
  async loadMorePurchasesUntilDayComplete(): Promise<void> {
    const before = this._purchases().length;
    await this.loadMore('purchase');
    let loaded = this._purchases();
    if (loaded.length === before) return; // rien chargé (échec réseau, ou déjà tout chargé)

    const boundaryDay = localDayStart(loaded[loaded.length - 1].fullTimestampMs);
    for (let page = 0; page < MAX_DAY_COMPLETION_PAGES && this.hasMore('purchase'); page++) {
      const previousLength = loaded.length;
      await this.loadMore('purchase');
      loaded = this._purchases();
      const oldest = loaded[loaded.length - 1];
      if (!oldest || loaded.length === previousLength) break;
      if (localDayStart(oldest.fullTimestampMs) !== boundaryDay) break; // jour limite dépassé : il est désormais complet
    }
  }

  /** Repart de zéro (déconnexion, ou synchronisation manuelle qui vient de pousser du contenu). */
  reset(): void {
    this._fights.set([]);
    this._purchases.set([]);
    this._trades.set([]);
    this.cursors.clear();
    this.loaded.clear();
    this._exhausted.set([]);
    this._failed.set(false);
  }

  /**
   * Corrige immédiatement une ligne de butin **déjà chargée** dans l'archive (voir
   * ItemPickerService) — miroir de `StatsStoreService.reassignLootItem` côté session : celui-ci
   * journalise et rejoue à chaque isInitialLoad (session), celui-ci met simplement à jour ce qui est
   * déjà en mémoire ici pour un retour visuel immédiat sur la page Historique, sans dupliquer
   * l'écriture du journal (déjà faite par l'appel jumeau à `StatsStoreService.reassignLootItem`, voir
   * les composants appelants). No-op silencieux si aucun combat archivé ne correspond.
   */
  reassignLootItem(
    fight: Pick<FightRecord, 'time' | 'result' | 'rows'>,
    itemName: string,
    sourceCatalogId: number | null,
    quantity: number,
    catalogId: number,
  ): void {
    const fightKey = fightDedupKey(fight);
    let corrected: FightRecord | null = null;
    this._fights.update((list) =>
      list.map((f) => {
        if (fightDedupKey(f) !== fightKey) return f;
        const loot = [...f.loot];
        const row = findRowByCatalogId(loot, itemName, sourceCatalogId);
        if (!row) return f;
        splitRowInPlace(loot, row, quantity, catalogId);
        corrected = { ...f, loot };
        return corrected;
      }),
    );
    if (corrected) this.historySync.recordFight(corrected);
  }

  /** Miroir de reassignLootItem, pour un achat. Une correction partielle crée un second achat
   * distinct plutôt que de scinder une ligne dans un tableau — voir
   * `StatsStoreService.applyPurchaseReassign`, même raison/même calcul de coût au prorata (ou
   * `kamasOverride` explicite, voir sa doc). */
  reassignPurchaseItem(
    purchase: Pick<PurchaseRecord, 'time' | 'item' | 'quantity' | 'totalCost'>,
    quantity: number,
    catalogId: number,
    kamasOverride?: number,
  ): void {
    const purchaseKey = purchaseDedupKey(purchase);
    const toSend: PurchaseRecord[] = [];
    this._purchases.update((list) => {
      const index = list.findIndex((p) => purchaseDedupKey(p) === purchaseKey);
      if (index === -1) return list;
      const record = list[index];
      const amount = Math.min(Math.max(1, Math.floor(quantity)), record.quantity);
      const next = [...list];
      if (amount >= record.quantity) {
        const corrected = { ...record, catalogId };
        next[index] = corrected;
        toSend.push(corrected);
        return next;
      }
      const unitCost = record.totalCost / record.quantity;
      const splitCost =
        kamasOverride !== undefined
          ? Math.min(Math.max(0, Math.round(kamasOverride)), record.totalCost)
          : Math.round(unitCost * amount);
      const reduced: PurchaseRecord = {
        ...record,
        quantity: record.quantity - amount,
        totalCost: record.totalCost - splitCost,
      };
      const split: PurchaseRecord = {
        ...record,
        id: this.nextSyntheticId--,
        catalogId,
        quantity: amount,
        totalCost: splitCost,
      };
      next[index] = reduced;
      next.push(split);
      toSend.push(reduced, split);
      return next;
    });
    for (const record of toSend) this.historySync.recordPurchase(record);
  }

  /** Miroir de reassignLootItem, pour une ligne d'objet échangé — voir
   * `StatsStoreService.reassignTradeItem` pour `sourceCatalogId`. */
  reassignTradeItem(
    trade: Pick<
      TradeRecord,
      'time' | 'characterName' | 'selfName' | 'kamasAcquired' | 'kamasGiven' | 'acquired' | 'given'
    >,
    direction: 'acquired' | 'given',
    itemName: string,
    sourceCatalogId: number | null,
    quantity: number,
    catalogId: number,
  ): void {
    const tradeKey = tradeDedupKey(trade);
    let corrected: TradeRecord | null = null;
    this._trades.update((list) =>
      list.map((t) => {
        if (tradeDedupKey(t) !== tradeKey) return t;
        const items = [...t[direction]];
        const row = findRowByCatalogId(items, itemName, sourceCatalogId);
        if (!row) return t;
        splitRowInPlace(items, row, quantity, catalogId);
        corrected = { ...t, [direction]: items };
        return corrected;
      }),
    );
    if (corrected) this.historySync.recordTrade(corrected);
  }
}

/** Élément de `list` dont le nom correspond (insensible à la casse) ET dont le `catalogId` actuel
 * est `sourceCatalogId` — voir `StatsStoreService.findRowByCatalogId`, même rôle côté archive. */
function findRowByCatalogId<T extends { name: string; catalogId: number | null }>(
  list: readonly T[],
  name: string,
  sourceCatalogId: number | null,
): T | undefined {
  const key = name.toLowerCase();
  return list.find((item) => item.name.toLowerCase() === key && item.catalogId === sourceCatalogId);
}

/** Réattribue tout ou partie de la quantité de `row` (déjà présente dans `list`, à l'index
 * `list.indexOf(row)`) vers `catalogId` — voir `StatsStoreService.reassignRowQuantity`, même
 * contrat (fusionne dans une ligne existante du même nom qui porte déjà ce `catalogId` plutôt que
 * d'en dupliquer une ; nouvelle ligne toujours ajoutée en FIN de `list` sinon ; `row` retirée de
 * `list` si sa quantité restante tombe à 0). Mute `list` (tableau déjà cloné par l'appelant, voir
 * `[...f.loot]`), pas `row` lui-même. */
function splitRowInPlace<T extends { name: string; catalogId: number | null; quantity: number }>(
  list: T[],
  row: T,
  quantity: number,
  catalogId: number,
): void {
  if (catalogId === row.catalogId) return;
  const index = list.indexOf(row);
  const amount = Math.min(Math.max(1, Math.floor(quantity)), row.quantity);
  const key = row.name.toLowerCase();
  const targetIndex = list.findIndex(
    (r, i) => i !== index && r.catalogId === catalogId && r.name.toLowerCase() === key,
  );
  if (targetIndex !== -1) {
    list[targetIndex] = { ...list[targetIndex], quantity: list[targetIndex].quantity + amount };
  } else {
    list.push({ ...row, catalogId, quantity: amount });
  }
  const remaining = row.quantity - amount;
  if (remaining <= 0) list.splice(index, 1);
  else list[index] = { ...row, quantity: remaining };
}

/**
 * Identifiants d'affichage **négatifs** : les composants d'historique indexent
 * leur état déplié par `id`, et un identifiant archivé ne doit jamais entrer en
 * collision avec un `fightId` du log (toujours positif).
 */
function archiveId(index: number): number {
  return -1 - index;
}

/** Heure locale au format du log (`HH:MM:SS,mmm`), reconstruite depuis l'horodatage archivé. */
function toLogTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '00:00:00,000';
  const pad = (value: number, size = 2): string => value.toString().padStart(size, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())},${pad(
    date.getMilliseconds(),
    3,
  )}`;
}

/** Nom affichable/canonique d'une ligne d'archive : `itemName` s'il est présent (objet non résolu
 * par le catalogue, seule source de vérité restante), sinon reconstruit en FRANÇAIS depuis
 * `itemId` (jamais la locale d'affichage — ce nom sert aussi d'identité pour le suivi/les alertes
 * son sur les lignes de butin fusionnées dans LootListComponent, qui comparent au nom brut du log,
 * jamais traduit). Repli sur `items.unknown` si aucun des deux n'est exploitable. */
function resolveItemName(
  itemId: number | null,
  itemName: string | null,
  catalog: CatalogService,
  i18n: I18nService,
): string {
  if (itemName !== null) return itemName;
  const entry = itemId !== null ? catalog.findWakfuItemEntryById(itemId) : undefined;
  return entry?.fr ?? i18n.t('items.unknown');
}

function toFightRecord(
  entry: FightPage['entries'][number],
  index: number,
  catalog: CatalogService,
  i18n: I18nService,
  stats: StatsStoreService,
  historySync: HistorySyncService,
): FightRecord {
  const instanceCounts = new Map<string, number>();
  for (const participant of entry.participants) {
    instanceCounts.set(participant.name, (instanceCounts.get(participant.name) ?? 0) + 1);
  }

  const rows: EntityDamageRow[] = entry.participants.map((participant) => ({
    name: participant.name,
    total: participant.damage,
    spells: (participant.spells ?? []).map((spell) => ({
      spell: spell.spell,
      total: spell.total,
      byElement: spell.byElement as SpellBreakdownRow['byElement'],
      // Le serveur ne stocke pas de ventilation par tour (voir SpellBreakdownRow.byTurn) : un
      // combat reconstruit depuis l'archive du compte n'a donc jamais de détail par tour, seule la
      // session en cours (et l'historique local qui en dérive) le connaît.
      byTurn: [],
    })),
    defeated: participant.defeated,
    instanceIndex: participant.instanceIndex,
    instanceCount: instanceCounts.get(participant.name) ?? 1,
  }));

  const time = toLogTime(entry.startedAt);
  const result = entry.won === false ? 'lost' : 'won';
  const sortedRows = rows.sort((a, b) => b.total - a.total);
  // Calculable dès maintenant (ne dépend que de time/result/participants, jamais du butin) — sert à
  // consulter une éventuelle correction manuelle déjà connue (voir ItemPickerService/
  // StatsStoreService.reassignLootItem) pour CE combat précis, qui vient d'être chargé pour la
  // première fois depuis l'archive (donc jamais encore vu par `reassignLootItem` lui-même).
  const fightKey = fightDedupKey({ time, result, rows: sortedRows });
  let anyCorrected = false;
  // sourceCatalogId = itemId TEL QUE RENVOYÉ PAR LE SERVEUR pour cette ligne — plus besoin de
  // compteur d'occurrence par nom (voir StatsStoreService.findLootCorrection) : le `catalogId`
  // identifie déjà la ligne sans ambiguïté.
  const loot = (entry.loot ?? []).map((row) => {
    const name = resolveItemName(row.itemId, row.itemName, catalog, i18n);
    const correction = stats.findLootCorrection(fightKey, name, row.itemId, row.quantity);
    if (correction !== null) anyCorrected = true;
    return { name, catalogId: correction ?? row.itemId, quantity: row.quantity };
  });

  const record: FightRecord = {
    id: archiveId(index),
    time,
    fullTimestampMs: new Date(entry.startedAt).getTime(),
    result,
    rows: sortedRows,
    // Le serveur ne stocke pas le détail du soin/de l'armure donnés (voir CLAUDE.md, onglets
    // Dommage/Armure/Soin) : un combat reconstruit depuis l'archive du compte n'a donc jamais ces
    // lignes, seule la session en cours (et l'historique local qui en dérive) les connaît.
    healRows: [],
    armorRows: [],
    loot,
    kamas: entry.kamasGained ?? 0,
    turns: entry.turns ?? 0,
    durationMs: entry.durationMs ?? 0,
    xp: buildXpRows(entry),
  };
  // La correction n'avait encore jamais pu atteindre le serveur pour CETTE ligne précise (elle
  // n'était pas encore chargée au moment de la correction d'origine, voir StatsStoreService.
  // applyLootReassign) — c'est cette première rencontre qui s'en charge, avec la même garantie
  // d'idempotence (ON CONFLICT DO UPDATE) que tout autre renvoi.
  if (anyCorrected) historySync.recordFight(record);
  return record;
}

/**
 * XP par personnage, reconstruite depuis les participants. Repli sur une ligne
 * anonyme portant le total du combat quand aucun participant n'a d'XP alors que
 * le combat en a rapporté : le cas ne devrait pas se produire (le log nomme le
 * bénéficiaire comme le combattant), mais mieux vaut afficher un total juste
 * sans nom que rien du tout.
 */
function buildXpRows(entry: FightPage['entries'][number]): FightRecord['xp'] {
  const rows = entry.participants
    .filter((participant) => (participant.xpGained ?? 0) > 0)
    .map((participant) => ({ name: participant.name, amount: participant.xpGained ?? 0 }))
    .sort((a, b) => b.amount - a.amount);
  if (rows.length > 0) return rows;
  return entry.xpGained ? [{ name: '', amount: entry.xpGained }] : [];
}

function toPurchaseRecord(
  entry: PurchasePage['entries'][number],
  index: number,
  catalog: CatalogService,
  i18n: I18nService,
  stats: StatsStoreService,
  historySync: HistorySyncService,
): PurchaseRecord {
  const item = resolveItemName(entry.itemId, entry.itemName, catalog, i18n);
  const time = toLogTime(entry.occurredAt);
  const purchaseKey = purchaseDedupKey({
    time,
    item,
    quantity: entry.quantity,
    totalCost: entry.totalCost,
  });
  const correction = stats.findPurchaseCorrection(purchaseKey, entry.quantity);
  const record: PurchaseRecord = {
    id: archiveId(index),
    item,
    catalogId: correction ?? entry.itemId,
    quantity: entry.quantity,
    totalCost: entry.totalCost,
    time,
    fullTimestampMs: new Date(entry.occurredAt).getTime(),
  };
  if (correction !== null) historySync.recordPurchase(record);
  return record;
}

function toTradeRecord(
  entry: TradePage['entries'][number],
  index: number,
  catalog: CatalogService,
  i18n: I18nService,
  stats: StatsStoreService,
  historySync: HistorySyncService,
): TradeRecord {
  const resolveItems = (
    items: { itemId: number | null; itemName: string | null; quantity: number }[],
  ) =>
    items.map((item) => ({
      name: resolveItemName(item.itemId, item.itemName, catalog, i18n),
      catalogId: item.itemId,
      quantity: item.quantity,
    }));
  const time = toLogTime(entry.occurredAt);
  const characterName = entry.peerName;
  const selfName = entry.selfName;
  const acquired = resolveItems(entry.acquired);
  const given = resolveItems(entry.given);
  const tradeKey = tradeDedupKey({
    time,
    characterName,
    selfName,
    kamasAcquired: entry.kamasAcquired,
    kamasGiven: entry.kamasGiven,
    acquired,
    given,
  });

  let anyCorrected = false;
  // sourceCatalogId = catalogId TEL QU'ENVOYÉ PAR LE SERVEUR pour cette ligne — plus besoin de
  // compteur d'occurrence par nom (voir StatsStoreService.findTradeItemCorrection).
  const applyCorrections = (
    items: { name: string; catalogId: number | null; quantity: number }[],
    direction: 'acquired' | 'given',
  ): void => {
    for (const item of items) {
      const correction = stats.findTradeItemCorrection(
        tradeKey,
        direction,
        item.name,
        item.catalogId,
        item.quantity,
      );
      if (correction !== null) {
        item.catalogId = correction;
        anyCorrected = true;
      }
    }
  };
  applyCorrections(acquired, 'acquired');
  applyCorrections(given, 'given');

  const record: TradeRecord = {
    id: archiveId(index),
    characterName,
    selfName,
    time,
    fullTimestampMs: new Date(entry.occurredAt).getTime(),
    acquired,
    given,
    kamasAcquired: entry.kamasAcquired,
    kamasGiven: entry.kamasGiven,
  };
  if (anyCorrected) historySync.recordTrade(record);
  return record;
}
