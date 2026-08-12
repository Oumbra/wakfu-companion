import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';
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
    loot: { itemId: number | null; itemName: string; quantity: number }[];
  }[];
  nextBefore: string | null;
}

interface PurchasePage {
  entries: {
    clientKey: string;
    itemId: number | null;
    itemName: string;
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
    acquired: { itemName: string; quantity: number }[];
    given: { itemName: string; quantity: number }[];
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

  private readonly _fights = signal<readonly FightRecord[]>([]);
  private readonly _purchases = signal<readonly PurchaseRecord[]>([]);
  private readonly _trades = signal<readonly TradeRecord[]>([]);
  private readonly _loading = signal(false);
  private readonly _failed = signal(false);
  /** Curseur de la page suivante par type ; `null` + `loaded` = tout est chargé. */
  private readonly cursors = new Map<HistoryEventKind, string | null>();
  private readonly loaded = new Set<HistoryEventKind>();
  private readonly _exhausted = signal<readonly HistoryEventKind[]>([]);

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
    return [...sessionOnly, ...accountTagged].sort(
      (a, b) => b.fullTimestampMs - a.fullTimestampMs,
    );
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
        .map((kind) => (kind === 'purchase' ? this.loadMorePurchasesUntilDayComplete() : this.loadMore(kind))),
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
            toFightRecord(entry, current.length + index),
          ),
        ]);
        break;
      case 'purchase':
        this._purchases.update((current) => [
          ...current,
          ...(result.data as PurchasePage).entries.map((entry, index) =>
            toPurchaseRecord(entry, current.length + index),
          ),
        ]);
        break;
      case 'trade':
        this._trades.update((current) => [
          ...current,
          ...(result.data as TradePage).entries.map((entry, index) =>
            toTradeRecord(entry, current.length + index),
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

function toFightRecord(entry: FightPage['entries'][number], index: number): FightRecord {
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
    })),
    defeated: participant.defeated,
    instanceIndex: participant.instanceIndex,
    instanceCount: instanceCounts.get(participant.name) ?? 1,
  }));

  return {
    id: archiveId(index),
    time: toLogTime(entry.startedAt),
    fullTimestampMs: new Date(entry.startedAt).getTime(),
    result: entry.won === false ? 'lost' : 'won',
    rows: rows.sort((a, b) => b.total - a.total),
    loot: (entry.loot ?? []).map((row) => ({ name: row.itemName, quantity: row.quantity })),
    turns: entry.turns ?? 0,
    durationMs: entry.durationMs ?? 0,
    xp: buildXpRows(entry),
  };
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

function toPurchaseRecord(entry: PurchasePage['entries'][number], index: number): PurchaseRecord {
  return {
    id: archiveId(index),
    item: entry.itemName,
    quantity: entry.quantity,
    totalCost: entry.totalCost,
    time: toLogTime(entry.occurredAt),
    fullTimestampMs: new Date(entry.occurredAt).getTime(),
  };
}

function toTradeRecord(entry: TradePage['entries'][number], index: number): TradeRecord {
  return {
    id: archiveId(index),
    characterName: entry.peerName,
    selfName: entry.selfName,
    time: toLogTime(entry.occurredAt),
    fullTimestampMs: new Date(entry.occurredAt).getTime(),
    acquired: entry.acquired.map((item) => ({ name: item.itemName, quantity: item.quantity })),
    given: entry.given.map((item) => ({ name: item.itemName, quantity: item.quantity })),
    kamasAcquired: entry.kamasAcquired,
    kamasGiven: entry.kamasGiven,
  };
}
