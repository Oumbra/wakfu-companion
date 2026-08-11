import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';
import type {
  EntityDamageRow,
  FightRecord,
  PurchaseRecord,
  SpellBreakdownRow,
  TradeRecord,
} from '../services/stats-store.service';
import { HISTORY_ENDPOINTS, type HistoryEventKind } from './history-event.model';

/** Taille d'une page de lecture (`GET /api/v1/history/*?limit=`). */
const PAGE_SIZE = 50;

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

/** Source affichée par la section Historique. */
export type HistorySource = 'session' | 'account';

/**
 * Lecture de l'historique archivé sur le compte (lot 8, prompt 8.1 — « GET
 * paginés pour l'affichage de l'historique »).
 *
 * ## Pourquoi une bascule, et non une fusion
 *
 * La liste de session (`StatsStoreService`) est reconstruite depuis le fichier
 * de log courant et plafonnée à 30 combats ; l'archive du compte, elle, contient
 * **tout**, y compris ce que la session vient d'envoyer. Fusionner les deux
 * demanderait de reconnaître localement qu'un événement de session est déjà
 * archivé — ce que seule la clé SHA-256 permet vraiment, au prix d'un calcul
 * asynchrone pour chaque ligne affichée, à chaque rendu.
 *
 * L'interface propose donc une bascule explicite « Session / Compte ». Elle est
 * plus honnête (on sait d'où viennent les lignes), et l'archive étant un
 * sur-ensemble de la session une fois la synchronisation faite, l'utilisateur
 * n'a rien à recouper lui-même.
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

  private readonly _source = signal<HistorySource>('session');
  private readonly _fights = signal<readonly FightRecord[]>([]);
  private readonly _purchases = signal<readonly PurchaseRecord[]>([]);
  private readonly _trades = signal<readonly TradeRecord[]>([]);
  private readonly _loading = signal(false);
  private readonly _failed = signal(false);
  /** Curseur de la page suivante par type ; `null` + `loaded` = tout est chargé. */
  private readonly cursors = new Map<HistoryEventKind, string | null>();
  private readonly loaded = new Set<HistoryEventKind>();
  private readonly _exhausted = signal<readonly HistoryEventKind[]>([]);

  readonly source = this._source.asReadonly();
  readonly fights = this._fights.asReadonly();
  readonly purchases = this._purchases.asReadonly();
  readonly trades = this._trades.asReadonly();
  readonly loading = this._loading.asReadonly();
  /** Vrai quand la dernière lecture a échoué (hors ligne, serveur indisponible). */
  readonly failed = this._failed.asReadonly();
  readonly showsAccount = computed(() => this._source() === 'account');

  hasMore(kind: HistoryEventKind): boolean {
    return !this._exhausted().includes(kind);
  }

  /**
   * Bascule la source affichée. Le premier passage sur « Compte » déclenche le
   * chargement de la première page de chaque type — l'utilisateur a cliqué, il
   * attend des données, pas un second clic par sous-onglet.
   */
  async setSource(source: HistorySource): Promise<void> {
    this._source.set(source);
    if (source !== 'account') return;
    await Promise.all(
      (Object.keys(HISTORY_ENDPOINTS) as HistoryEventKind[])
        .filter((kind) => !this.loaded.has(kind))
        .map((kind) => this.loadMore(kind)),
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

  /** Repart de zéro (déconnexion, ou synchronisation manuelle qui vient de pousser du contenu). */
  reset(): void {
    this._source.set('session');
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
