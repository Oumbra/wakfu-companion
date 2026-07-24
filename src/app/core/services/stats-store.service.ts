import { computed, Injectable, signal, WritableSignal } from '@angular/core';
import { ChatMessageEntry, DamageElement, DamageEntry, LogEntry } from '../models/log-entry.model';
import { EntityClassifierService } from './entity-classifier.service';
import { LogFileAccessService } from './log-file-access.service';
import { LogParser } from './log-parser';
import { LootAlertService } from './loot-alert.service';
import { PersistenceService } from './persistence.service';
import { ProfileService } from './profile.service';

const WATCHLIST_KEY = 'wakfu-watchlist';
/** Anciennes clés (listes séparées), lues une seule fois pour migrer vers la liste fusionnée si besoin. */
const LEGACY_ENEMY_WATCHLIST_KEY = 'wakfu-enemy-watchlist';
const LEGACY_ITEM_WATCHLIST_KEY = 'wakfu-item-watchlist';
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

export type WatchlistKind = 'enemy' | 'item';

/** Entrée de suivi générique : ennemi vaincu ou ressource/objet obtenu, distingués par `kind`. */
export interface WatchlistEntry {
  name: string;
  count: number;
  kind: WatchlistKind;
}

export interface LootRow {
  name: string;
  quantity: number;
}

export interface FightRecord {
  id: number;
  time: string;
  /** Horodatage complet (epoch ms) du combat, prêt à formater selon la langue courante (le log Wakfu n'expose que l'heure, complétée par la date système). */
  fullTimestampMs: number;
  result: 'won' | 'lost';
  rows: EntityDamageRow[];
  loot: LootRow[];
  turns: number;
  durationMs: number;
  xp: XpRow[];
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

  readonly challengesPassed = signal(0);
  readonly challengesFailed = signal(0);

  /** Nombre de tours et durée écoulée du combat en cours (vue "Combat en cours"), recalculés à chaque lot de lignes traité. */
  readonly currentFightTurns = signal(1);
  readonly currentFightDurationMs = signal(0);

  readonly xpByCharacter = signal<XpRow[]>([]);
  readonly damageByAttacker = signal<EntityDamageRow[]>([]);
  readonly fightHistory = signal<FightRecord[]>([]);
  readonly chatMessages = signal<ChatMessageEntry[]>([]);
  /** Suivi fusionné (ennemis vaincus + ressources obtenues), distingué par `kind`. */
  readonly watchlist = signal<WatchlistEntry[]>([]);

  private readonly xpMap = new Map<string, number>();
  private readonly attackerMap = new Map<string, Map<string, SpellAgg>>();
  private readonly currentFightXpMap = new Map<string, number>();
  private readonly chatBuffer: ChatMessageEntry[] = [];
  private readonly fightHistoryList: FightRecord[] = [];
  /** Butin accumulé depuis le début du combat en cours (les lignes "ramassé" arrivent avant la détection de fin de combat, pas après). */
  private currentFightLoot: LootRow[] = [];
  private currentFightStartTime: string | null = null;
  /** Horodatage de la dernière ligne traitée : sert à calculer la durée écoulée du combat en cours. */
  private lastLineTime: string | null = null;
  /** Noms (en minuscules) déjà mis KO ce combat-ci : évite un double comptage du suivi des ennemis à la conclusion du combat, et alimente le badge KO affiché sur la ligne. */
  private readonly currentFightDefeatedNames = new Set<string>();
  /** Vrai pendant le traitement du tout premier lot de lignes d'une connexion (contenu déjà présent dans le fichier) : les compteurs de suivi ne doivent pas être incrémentés pour cet historique déjà vécu. */
  private currentBatchIsInitialLoad = false;

  /** Vrai si le dernier lot de lignes traité provenait d'un rechargement initial (historique déjà vécu) — à consulter par tout consommateur voulant éviter de réagir (ex. alerte sonore) à du contenu déjà connu. */
  wasLastBatchInitialLoad(): boolean {
    return this.currentBatchIsInitialLoad;
  }
  private nextFightId = 1;

  constructor(
    private readonly logFileAccess: LogFileAccessService,
    private readonly persistence: PersistenceService,
    private readonly classifier: EntityClassifierService,
    private readonly profile: ProfileService,
    private readonly lootAlert: LootAlertService,
  ) {
    this.watchlist.set(this.loadWatchlist());
    this.logFileAccess.newLines$.subscribe(({ lines, isInitialLoad }) =>
      this.ingest(lines, isInitialLoad),
    );
  }

  private loadWatchlist(): WatchlistEntry[] {
    const stored = this.persistence.getJson<WatchlistEntry[]>(WATCHLIST_KEY);
    if (stored) return stored;
    // Migration ponctuelle depuis les deux anciennes listes séparées.
    const legacyEnemies = this.persistence.getJson<{ name: string; count: number }[]>(
      LEGACY_ENEMY_WATCHLIST_KEY,
    );
    const legacyItems = this.persistence.getJson<{ name: string; count: number }[]>(
      LEGACY_ITEM_WATCHLIST_KEY,
    );
    if (!legacyEnemies && !legacyItems) return [];
    const migrated: WatchlistEntry[] = [
      ...(legacyEnemies ?? []).map((w) => ({ ...w, kind: 'enemy' as const })),
      ...(legacyItems ?? []).map((w) => ({ ...w, kind: 'item' as const })),
    ];
    this.persistence.setJson(WATCHLIST_KEY, migrated);
    return migrated;
  }

  addWatchedEnemy(rawName: string): void {
    this.addWatched(rawName, 'enemy');
  }

  addWatchedItem(rawName: string): void {
    this.addWatched(rawName, 'item');
  }

  /** Utilisé pour masquer l'invite "clic droit pour suivre" une fois l'entrée déjà suivie. */
  isWatched(rawName: string): boolean {
    const name = rawName.trim().toLowerCase();
    return this.watchlist().some((w) => w.name.toLowerCase() === name);
  }

  removeWatched(name: string): void {
    const updated = this.watchlist().filter((w) => w.name !== name);
    this.watchlist.set(updated);
    this.persistence.setJson(WATCHLIST_KEY, updated);
  }

  /** Remet à zéro le compteur d'une seule entrée suivie (sans la retirer de la liste). */
  resetWatchedCount(name: string): void {
    const updated = this.watchlist().map((w) => (w.name === name ? { ...w, count: 0 } : w));
    this.watchlist.set(updated);
    this.persistence.setJson(WATCHLIST_KEY, updated);
  }

  reorderWatchlist(fromIndex: number, toIndex: number): void {
    const updated = this.watchlist().slice();
    const [moved] = updated.splice(fromIndex, 1);
    if (!moved) return;
    updated.splice(toIndex, 0, moved);
    this.watchlist.set(updated);
    this.persistence.setJson(WATCHLIST_KEY, updated);
  }

  /** Remet à zéro les compteurs de la session (conserve les noms suivis). */
  resetStats(): void {
    this.resetSessionState();
    this.publish();

    const resetCounts = this.watchlist().map((w) => ({ ...w, count: 0 }));
    this.watchlist.set(resetCounts);
    this.persistence.setJson(WATCHLIST_KEY, resetCounts);
  }

  private ingest(lines: string[], isInitialLoad: boolean): void {
    this.currentBatchIsInitialLoad = isInitialLoad;
    if (isInitialLoad) {
      // Une (re)connexion relit tout le fichier depuis le début : sans ce
      // nettoyage, l'historique de combats (et les autres stats dérivées du
      // fichier) déjà reconstruits lors d'une connexion précédente seraient
      // dupliqués au lieu d'être simplement reconstruits à l'identique.
      this.resetSessionState();
    }
    for (const line of lines) {
      const entry = this.parser.parseLine(line);
      if (entry) this.apply(entry);
    }
    this.classifier.commit();
    this.publish();
  }

  /**
   * Réinitialise tout ce qui est dérivé du contenu du fichier (historique de
   * combats, kamas, xp, combats gagnés/perdus, chat...) — mais PAS le suivi
   * (`watchlist`), qui doit persister indépendamment des reconnexions/du
   * fichier actuellement ouvert (voir resetStats() pour la remise à zéro
   * explicite et complète demandée par l'utilisateur).
   */
  private resetSessionState(): void {
    this.sessionStartedAt.set(Date.now());

    this.kamasEarned.set(0);
    this.kamasLost.set(0);
    this.combatsWon.set(0);
    this.combatsLost.set(0);
    this.challengesPassed.set(0);
    this.challengesFailed.set(0);
    this.currentFightTurns.set(1);

    this.xpMap.clear();
    this.currentFightXpMap.clear();

    this.attackerMap.clear();

    this.fightHistoryList.length = 0;
    this.currentFightLoot = [];
    this.currentFightStartTime = null;
    this.lastLineTime = null;
    this.currentFightDefeatedNames.clear();
    this.nextFightId = 1;

    this.chatBuffer.length = 0;
  }

  private apply(entry: LogEntry): void {
    this.lastLineTime = entry.time;
    switch (entry.kind) {
      case 'kama-gain':
        this.kamasEarned.update((v) => v + entry.amount);
        break;
      case 'kama-loss':
        this.kamasLost.update((v) => v + entry.amount);
        break;
      case 'xp-gain':
        this.xpMap.set(entry.character, (this.xpMap.get(entry.character) ?? 0) + entry.amount);
        this.currentFightXpMap.set(
          entry.character,
          (this.currentFightXpMap.get(entry.character) ?? 0) + entry.amount,
        );
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
        this.currentFightTurns.set(1);
        this.currentFightStartTime = entry.time;
        break;
      case 'combat-end': {
        const result = this.resolveFightResult(entry.result);
        this.concludeFight(entry.time, result);
        if (result === 'won') this.combatsWon.update((v) => v + 1);
        else this.combatsLost.update((v) => v + 1);
        break;
      }
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
        this.currentFightTurns.update((v) => v + 1);
        break;
      case 'challenge-result':
        if (entry.success) this.challengesPassed.update((v) => v + 1);
        else this.challengesFailed.update((v) => v + 1);
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
      case 'fighter-joined':
        this.classifier.registerFighterJoin(entry.name, entry.isControlledByAI);
        // Un combattant qui ne prend/inflige jamais de dégâts (ex. tué en un
        // coup avant d'avoir pu jouer) doit quand même apparaître dans le
        // combat, comme pour une mise KO sans dégât infligé (voir ci-dessus).
        this.ensurePresent(this.attackerMap, entry.name);
        break;
      case 'combat-defeat-marker':
        break;
    }
  }

  /**
   * Le marqueur explicite "Vous avez été vaincu(e) !" n'apparaît pas toujours
   * (ex. combat en multi-compte où le client n'affiche pas cet écran) : si
   * tous les alliés ayant participé au combat sont KO à la fin, c'est une
   * défaite quoi qu'en dise ce marqueur.
   */
  private resolveFightResult(parsedResult: 'won' | 'lost'): 'won' | 'lost' {
    if (parsedResult === 'lost') return 'lost';
    const allies = [...this.attackerMap.keys()].filter(
      (name) => this.classifier.classify(name) === 'ally',
    );
    const allAlliesDefeated =
      allies.length > 0 &&
      allies.every((name) => this.currentFightDefeatedNames.has(name.toLowerCase()));
    return allAlliesDefeated ? 'lost' : 'won';
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
      fullTimestampMs: this.buildFullTimestampMs(time),
      result,
      rows: this.buildEntityDamageRows(this.attackerMap, this.currentFightDefeatedNames),
      loot: this.currentFightLoot,
      turns: this.currentFightTurns(),
      durationMs: this.currentFightStartTime
        ? this.computeDurationMs(this.currentFightStartTime, time)
        : 0,
      xp: [...this.currentFightXpMap.entries()]
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount),
    };
    this.fightHistoryList.unshift(record);
    this.fightHistoryList.length = Math.min(this.fightHistoryList.length, MAX_FIGHT_HISTORY);
    this.attackerMap.clear();
    this.currentFightLoot = [];
    this.currentFightTurns.set(1);
    this.currentFightStartTime = null;
    this.currentFightDefeatedNames.clear();
    this.currentFightXpMap.clear();
  }

  /** Le log Wakfu n'expose que l'heure (HH:MM:SS,mmm) : on la combine à la date système, le fichier étant lu en direct au fil de l'eau. */
  private buildFullTimestampMs(time: string): number {
    const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(time);
    const now = new Date();
    if (!match) return now.getTime();
    const [, h, m, s, ms] = match;
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      +h,
      +m,
      +s,
      +ms,
    ).getTime();
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
    // Le contenu déjà présent dans le fichier au premier chargement ne doit pas
    // regonfler un compteur qui persiste d'une session à l'autre.
    if (this.currentBatchIsInitialLoad) return;
    this.incrementWatched(name);
  }

  private registerLoot(item: string, quantity: number): void {
    if (!this.currentBatchIsInitialLoad) {
      this.incrementWatched(item, quantity);
      const soundEntry = this.profile.findEnabledSoundItem(item);
      if (soundEntry) this.lootAlert.trigger(item, quantity);
    }

    const existing = this.currentFightLoot.find(
      (l) => l.name.toLowerCase() === item.toLowerCase(),
    );
    if (existing) existing.quantity += quantity;
    else this.currentFightLoot.push({ name: item, quantity });
  }

  private addWatched(rawName: string, kind: WatchlistKind): void {
    const name = rawName.trim();
    if (!name) return;
    const current = this.watchlist();
    if (current.some((w) => w.name.toLowerCase() === name.toLowerCase())) return;
    const updated = [...current, { name, count: 0, kind }];
    this.watchlist.set(updated);
    this.persistence.setJson(WATCHLIST_KEY, updated);
  }

  private incrementWatched(name: string, by = 1): void {
    const normalized = name.trim().toLowerCase();
    const current = this.watchlist();
    const idx = current.findIndex((w) => w.name.toLowerCase() === normalized);
    if (idx === -1) return;
    const updated = current.slice();
    updated[idx] = { ...updated[idx], count: updated[idx].count + by };
    this.watchlist.set(updated);
    this.persistence.setJson(WATCHLIST_KEY, updated);
  }

  private publish(): void {
    this.currentFightDurationMs.set(
      this.currentFightStartTime && this.lastLineTime
        ? this.computeDurationMs(this.currentFightStartTime, this.lastLineTime)
        : 0,
    );
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
