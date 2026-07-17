import { computed, Injectable, signal, WritableSignal } from '@angular/core';
import { ChatMessageEntry, DamageElement, DamageEntry, LogEntry } from '../models/log-entry.model';
import { EntityClassifierService } from './entity-classifier.service';
import { LogFileAccessService } from './log-file-access.service';
import { LogParser } from './log-parser';
import { PersistenceService } from './persistence.service';

const ENEMY_WATCHLIST_KEY = 'wakfu-enemy-watchlist';
const ITEM_WATCHLIST_KEY = 'wakfu-item-watchlist';
const MAX_CHAT_MESSAGES = 2000;
const MAX_FIGHT_HISTORY = 30;

interface SpellAgg {
  total: number;
  byElement: Map<DamageElement, number>;
}

export interface SpellBreakdownRow {
  spell: string;
  total: number;
  byElement: Partial<Record<DamageElement, number>>;
}

export interface EntityDamageRow {
  name: string;
  total: number;
  spells: SpellBreakdownRow[];
  defeated: boolean;
}

export interface XpRow {
  name: string;
  amount: number;
}

/** Entrée de suivi générique : ennemis vaincus ou ressources/objets obtenus. */
export interface WatchlistEntry {
  name: string;
  count: number;
}

export interface LootRow {
  name: string;
  quantity: number;
}

export interface FightRecord {
  id: number;
  time: string;
  /** Date et heure complètes du combat, prêtes à afficher (le log Wakfu n'expose que l'heure). */
  fullTimestamp: string;
  result: 'won' | 'lost';
  rows: EntityDamageRow[];
  loot: LootRow[];
  turns: number;
  durationMs: number;
}

/**
 * État agrégé de la session courante. Consomme les lots de lignes émis par
 * LogFileAccessService, les fait passer par LogParser, et republie des
 * signaux déjà triés/prêts pour l'affichage après chaque lot (pas ligne par
 * ligne, pour rester fluide même sur la lecture initiale d'un gros fichier).
 *
 * Le méter de dégâts se fige et se réinitialise à chaque fin de combat : la
 * vue "Combat en cours" ne montre que le combat en jeu, et un instantané est
 * archivé dans `fightHistory`. Les stats de session (kamas/xp/combats) restent
 * cumulatives sur toute la session.
 */
@Injectable({ providedIn: 'root' })
export class StatsStoreService {
  private readonly parser = new LogParser();

  readonly sessionStartedAt = signal<number | null>(null);

  readonly kamasEarned = signal(0);
  readonly kamasLost = signal(0);
  readonly netKamas = computed(() => this.kamasEarned() - this.kamasLost());

  readonly combatsWon = signal(0);
  readonly combatsLost = signal(0);
  readonly totalCombats = computed(() => this.combatsWon() + this.combatsLost());

  readonly xpByCharacter = signal<XpRow[]>([]);
  readonly damageByAttacker = signal<EntityDamageRow[]>([]);
  readonly fightHistory = signal<FightRecord[]>([]);
  readonly chatMessages = signal<ChatMessageEntry[]>([]);
  readonly enemyWatchlist = signal<WatchlistEntry[]>([]);
  readonly itemWatchlist = signal<WatchlistEntry[]>([]);

  private readonly xpMap = new Map<string, number>();
  private readonly attackerMap = new Map<string, Map<string, SpellAgg>>();
  private readonly chatBuffer: ChatMessageEntry[] = [];
  private readonly fightHistoryList: FightRecord[] = [];
  /** Butin accumulé depuis le début du combat en cours (les lignes "ramassé" arrivent avant la détection de fin de combat, pas après). */
  private currentFightLoot: LootRow[] = [];
  /** Compte le premier tour (jamais annoncé par un marqueur) plus une transition par marqueur "tour suivant" rencontré. */
  private currentFightTurns = 1;
  private currentFightStartTime: string | null = null;
  /** Noms (en minuscules) déjà mis KO ce combat-ci : évite un double comptage du suivi des ennemis à la conclusion du combat, et alimente le badge KO affiché sur la ligne. */
  private readonly currentFightDefeatedNames = new Set<string>();
  private nextFightId = 1;

  constructor(
    private readonly logFileAccess: LogFileAccessService,
    private readonly persistence: PersistenceService,
    private readonly classifier: EntityClassifierService,
  ) {
    this.enemyWatchlist.set(this.persistence.getJson<WatchlistEntry[]>(ENEMY_WATCHLIST_KEY) ?? []);
    this.itemWatchlist.set(this.persistence.getJson<WatchlistEntry[]>(ITEM_WATCHLIST_KEY) ?? []);
    this.logFileAccess.newLines$.subscribe((lines) => this.ingest(lines));
  }

  addWatchedEnemy(rawName: string): void {
    this.addWatched(this.enemyWatchlist, ENEMY_WATCHLIST_KEY, rawName);
  }

  removeWatchedEnemy(name: string): void {
    this.removeWatched(this.enemyWatchlist, ENEMY_WATCHLIST_KEY, name);
  }

  addWatchedItem(rawName: string): void {
    this.addWatched(this.itemWatchlist, ITEM_WATCHLIST_KEY, rawName);
  }

  removeWatchedItem(name: string): void {
    this.removeWatched(this.itemWatchlist, ITEM_WATCHLIST_KEY, name);
  }

  reorderEnemyWatchlist(fromIndex: number, toIndex: number): void {
    this.reorderWatched(this.enemyWatchlist, ENEMY_WATCHLIST_KEY, fromIndex, toIndex);
  }

  reorderItemWatchlist(fromIndex: number, toIndex: number): void {
    this.reorderWatched(this.itemWatchlist, ITEM_WATCHLIST_KEY, fromIndex, toIndex);
  }

  /** Remet à zéro les compteurs de la session (conserve les noms suivis). */
  resetStats(): void {
    this.sessionStartedAt.set(Date.now());

    this.kamasEarned.set(0);
    this.kamasLost.set(0);
    this.combatsWon.set(0);
    this.combatsLost.set(0);

    this.xpMap.clear();
    this.xpByCharacter.set([]);

    this.attackerMap.clear();
    this.damageByAttacker.set([]);

    this.fightHistoryList.length = 0;
    this.fightHistory.set([]);
    this.currentFightLoot = [];
    this.currentFightTurns = 1;
    this.currentFightStartTime = null;
    this.currentFightDefeatedNames.clear();

    this.chatBuffer.length = 0;
    this.chatMessages.set([]);

    this.resetWatchCounts(this.enemyWatchlist, ENEMY_WATCHLIST_KEY);
    this.resetWatchCounts(this.itemWatchlist, ITEM_WATCHLIST_KEY);
  }

  private ingest(lines: string[]): void {
    if (this.sessionStartedAt() === null) {
      this.sessionStartedAt.set(Date.now());
    }
    for (const line of lines) {
      const entry = this.parser.parseLine(line);
      if (entry) this.apply(entry);
    }
    this.classifier.commit();
    this.publish();
  }

  private apply(entry: LogEntry): void {
    switch (entry.kind) {
      case 'kama-gain':
        this.kamasEarned.update((v) => v + entry.amount);
        break;
      case 'kama-loss':
        this.kamasLost.update((v) => v + entry.amount);
        break;
      case 'xp-gain':
        this.xpMap.set(entry.character, (this.xpMap.get(entry.character) ?? 0) + entry.amount);
        break;
      case 'combat-start':
        if (this.attackerMap.size > 0) {
          // Filet de sécurité : le marqueur de fin du combat précédent n'a
          // pas été reçu (ex. ligne perdue lors d'une rotation du fichier de
          // log). On le clôture quand même plutôt que de fusionner ses
          // dégâts avec ceux du nouveau combat qui démarre.
          this.concludeFight(entry.time, 'won');
          this.combatsWon.update((v) => v + 1);
        }
        this.currentFightLoot = [];
        this.currentFightTurns = 1;
        this.currentFightStartTime = entry.time;
        break;
      case 'combat-end':
        this.concludeFight(entry.time, entry.result);
        if (entry.result === 'won') this.combatsWon.update((v) => v + 1);
        else this.combatsLost.update((v) => v + 1);
        break;
      case 'enemy-defeated':
        this.registerDefeat(entry.name);
        this.currentFightDefeatedNames.add(entry.name.toLowerCase());
        // Un personnage mis KO sans avoir infligé de dégât doit quand même
        // apparaître dans le combat (à 0 dégât), pas seulement les attaquants.
        this.ensurePresent(this.attackerMap, entry.name);
        break;
      case 'damage':
        this.addDamage(this.attackerMap, entry.attacker, entry);
        this.classifier.registerDamageTarget(entry.target, entry.attacker);
        break;
      case 'loot':
        this.registerLoot(entry.item, entry.quantity);
        break;
      case 'turn-marker':
        this.currentFightTurns += 1;
        break;
      case 'chat':
        this.chatBuffer.push(entry);
        if (this.chatBuffer.length > MAX_CHAT_MESSAGES) {
          this.chatBuffer.splice(0, this.chatBuffer.length - MAX_CHAT_MESSAGES);
        }
        break;
      case 'spell-cast':
        this.classifier.registerSpellCast(entry.caster, entry.spell);
        break;
      case 'combat-defeat-marker':
        break;
    }
  }

  private concludeFight(time: string, result: 'won' | 'lost'): void {
    if (result === 'won') {
      // Le dernier ennemi d'un combat (souvent le boss) meurt en même temps que
      // le combat se termine et n'a alors pas droit à sa propre ligne "est KO !"
      // (contrairement aux adds tués en cours de route) : sans ce filet, il
      // n'est jamais crédité dans le suivi des ennemis vaincus. Un combat gagné
      // implique que tous les ennemis ayant combattu sont morts.
      for (const name of this.attackerMap.keys()) {
        if (
          this.classifier.classify(name) === 'enemy' &&
          !this.currentFightDefeatedNames.has(name.toLowerCase())
        ) {
          this.registerDefeat(name);
          this.currentFightDefeatedNames.add(name.toLowerCase());
        }
      }
    }

    const record: FightRecord = {
      id: this.nextFightId++,
      time,
      fullTimestamp: this.formatFullTimestamp(time),
      result,
      rows: this.buildEntityDamageRows(this.attackerMap, this.currentFightDefeatedNames),
      loot: this.currentFightLoot,
      turns: this.currentFightTurns,
      durationMs: this.currentFightStartTime
        ? this.computeDurationMs(this.currentFightStartTime, time)
        : 0,
    };
    this.fightHistoryList.unshift(record);
    this.fightHistoryList.length = Math.min(this.fightHistoryList.length, MAX_FIGHT_HISTORY);
    this.attackerMap.clear();
    this.currentFightLoot = [];
    this.currentFightTurns = 1;
    this.currentFightStartTime = null;
    this.currentFightDefeatedNames.clear();
  }

  /** Le log Wakfu n'expose que l'heure (HH:MM:SS,mmm) : on complète avec la date système, le fichier étant lu en direct au fil de l'eau. */
  private formatFullTimestamp(time: string): string {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${now.getFullYear()} ${time.split(',')[0]}`;
  }

  private computeDurationMs(startTime: string, endTime: string): number {
    const diff = this.timeToMs(endTime) - this.timeToMs(startTime);
    return diff >= 0 ? diff : diff + 24 * 60 * 60 * 1000;
  }

  private timeToMs(time: string): number {
    const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(time);
    if (!match) return 0;
    const [, h, m, s, ms] = match;
    return ((+h * 60 + +m) * 60 + +s) * 1000 + +ms;
  }

  /** Garantit une ligne à 0 dégât pour un personnage sans y écraser des dégâts déjà enregistrés. */
  private ensurePresent(map: Map<string, Map<string, SpellAgg>>, name: string): void {
    if (!map.has(name)) map.set(name, new Map());
  }

  private addDamage(
    map: Map<string, Map<string, SpellAgg>>,
    key: string,
    entry: DamageEntry,
  ): void {
    let spells = map.get(key);
    if (!spells) {
      spells = new Map();
      map.set(key, spells);
    }
    let agg = spells.get(entry.spell);
    if (!agg) {
      agg = { total: 0, byElement: new Map() };
      spells.set(entry.spell, agg);
    }
    agg.total += entry.amount;
    agg.byElement.set(entry.element, (agg.byElement.get(entry.element) ?? 0) + entry.amount);
  }

  private registerDefeat(name: string): void {
    this.incrementWatched(this.enemyWatchlist, ENEMY_WATCHLIST_KEY, name);
  }

  private registerLoot(item: string, quantity: number): void {
    this.incrementWatched(this.itemWatchlist, ITEM_WATCHLIST_KEY, item, quantity);

    const existing = this.currentFightLoot.find(
      (l) => l.name.toLowerCase() === item.toLowerCase(),
    );
    if (existing) existing.quantity += quantity;
    else this.currentFightLoot.push({ name: item, quantity });
  }

  private addWatched(
    list: WritableSignal<WatchlistEntry[]>,
    key: string,
    rawName: string,
  ): void {
    const name = rawName.trim();
    if (!name) return;
    const current = list();
    if (current.some((w) => w.name.toLowerCase() === name.toLowerCase())) return;
    const updated = [...current, { name, count: 0 }];
    list.set(updated);
    this.persistence.setJson(key, updated);
  }

  private removeWatched(
    list: WritableSignal<WatchlistEntry[]>,
    key: string,
    name: string,
  ): void {
    const updated = list().filter((w) => w.name !== name);
    list.set(updated);
    this.persistence.setJson(key, updated);
  }

  private reorderWatched(
    list: WritableSignal<WatchlistEntry[]>,
    key: string,
    fromIndex: number,
    toIndex: number,
  ): void {
    const updated = list().slice();
    const [moved] = updated.splice(fromIndex, 1);
    if (!moved) return;
    updated.splice(toIndex, 0, moved);
    list.set(updated);
    this.persistence.setJson(key, updated);
  }

  private incrementWatched(
    list: WritableSignal<WatchlistEntry[]>,
    key: string,
    name: string,
    by = 1,
  ): void {
    const normalized = name.trim().toLowerCase();
    const current = list();
    const idx = current.findIndex((w) => w.name.toLowerCase() === normalized);
    if (idx === -1) return;
    const updated = current.slice();
    updated[idx] = { ...updated[idx], count: updated[idx].count + by };
    list.set(updated);
    this.persistence.setJson(key, updated);
  }

  private resetWatchCounts(list: WritableSignal<WatchlistEntry[]>, key: string): void {
    const updated = list().map((w) => ({ ...w, count: 0 }));
    list.set(updated);
    this.persistence.setJson(key, updated);
  }

  private publish(): void {
    this.xpByCharacter.set(
      [...this.xpMap.entries()]
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount),
    );
    this.damageByAttacker.set(
      this.buildEntityDamageRows(this.attackerMap, this.currentFightDefeatedNames),
    );
    this.fightHistory.set([...this.fightHistoryList]);
    this.chatMessages.set([...this.chatBuffer]);
  }

  private buildEntityDamageRows(
    map: Map<string, Map<string, SpellAgg>>,
    defeatedNames: ReadonlySet<string>,
  ): EntityDamageRow[] {
    return [...map.entries()]
      .map(([name, spells]) => {
        const spellRows: SpellBreakdownRow[] = [...spells.entries()]
          .map(([spell, agg]) => ({
            spell,
            total: agg.total,
            byElement: Object.fromEntries(agg.byElement) as Partial<Record<DamageElement, number>>,
          }))
          .sort((a, b) => b.total - a.total);
        const total = spellRows.reduce((sum, row) => sum + row.total, 0);
        return { name, total, spells: spellRows, defeated: defeatedNames.has(name.toLowerCase()) };
      })
      .sort((a, b) => b.total - a.total);
  }
}
