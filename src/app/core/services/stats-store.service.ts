import { computed, Injectable, signal } from '@angular/core';
import { ChatMessageEntry, DamageElement, DamageEntry, LogEntry } from '../models/log-entry.model';
import { Fight } from '../models/fight.model';
import { WAKFU_ITEMS_FR } from '../data/wakfu-items.data';
import { normalizeWakfuName } from '../utils/wakfu-name.util';
import { CharacterRosterService } from './character-roster.service';
import { EntityClassifierService } from './entity-classifier.service';
import { LogFileAccessService } from './log-file-access.service';
import { LogParser } from './log-parser';
import { LootAlertService } from './loot-alert.service';
import { PersistenceService } from './persistence.service';
import { ProfileService } from './profile.service';

export const WATCHLIST_KEY = 'wakfu-watchlist';
/** Anciennes clés (listes séparées), lues une seule fois pour migrer vers la liste fusionnée si besoin. */
const LEGACY_ENEMY_WATCHLIST_KEY = 'wakfu-enemy-watchlist';
const LEGACY_ITEM_WATCHLIST_KEY = 'wakfu-item-watchlist';
const MAX_CHAT_MESSAGES = 2000;
const MAX_FIGHT_HISTORY = 30;
/** Fenêtre de rapprochement entre une perte de kamas et le ramassage d'objet qui suit : signature d'un achat (marchand/HDV). Au-delà, on considère qu'il s'agit de deux événements sans rapport. */
const PURCHASE_WINDOW_MS = 2000;

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

/** 'up' (défaut, comportement historique) : `count` part de 0 et s'incrémente à chaque
 * occurrence. 'down' : `count` part de `countdownTarget` et décompte vers 0 à chaque occurrence —
 * déclenche l'alerte (son + toast + confettis, voir LootAlertService) au moment où il atteint 0. */
export type WatchlistCounterMode = 'up' | 'down';

/** Entrée de suivi générique : ennemi vaincu ou ressource/objet obtenu, distingués par `kind`. */
export interface WatchlistEntry {
  name: string;
  count: number;
  kind: WatchlistKind;
  mode: WatchlistCounterMode;
  /** Valeur de départ du décompte en mode 'down' (ignorée en mode 'up') — aussi la valeur
   * restaurée par resetWatchedCount() dans ce mode. */
  countdownTarget: number;
}

export interface LootRow {
  name: string;
  quantity: number;
}

/** Un achat individuel (objet, quantité, coût total, horodatage) : détecté quand une perte de kamas est immédiatement suivie d'un ramassage d'objet (voir registerPurchase). */
export interface PurchaseRecord {
  id: number;
  item: string;
  quantity: number;
  totalCost: number;
  fullTimestampMs: number;
}

export interface TradeItemRow {
  name: string;
  quantity: number;
}

/** Un échange individuel avec un autre joueur (objets/kamas acquis/cédés). `characterName` désigne le personnage EN FACE, `selfName` le personnage du compte courant (roster déclaré en page profil, voir CharacterRosterService) — un échange entre deux personnages du roster est ignoré (voir registerTrade), il n'y a donc jamais d'ambiguïté sur lequel des deux est "en face". */
export interface TradeRecord {
  id: number;
  characterName: string;
  selfName: string;
  fullTimestampMs: number;
  acquired: TradeItemRow[];
  given: TradeItemRow[];
  kamasAcquired: number;
  kamasGiven: number;
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

/** État de travail d'un combat en cours, indexé par fightId — voir Fight (core/models/fight.model.ts). Isoler cet état par combat (plutôt qu'un unique état global) permet à plusieurs combats concurrents (multi-compte) de ne jamais se corrompre l'un l'autre. */
interface FightWorking {
  fight: Fight;
  attackerMap: Map<string, Map<string, SpellAgg>>;
  defeatedNames: Set<string>;
  /** fighterId déjà vus (voir FighterJoinedEntry) : une jointure répétée (doublon multi-compte, resynchronisation) ne doit pas dupliquer l'entrée dans allies/enemies. */
  fighterIdsSeen: Set<number>;
}

/**
 * État agrégé de la session courante. Consomme les lots de lignes émis par
 * LogFileAccessService, les fait passer par LogParser, et republie des
 * signaux déjà triés/prêts pour l'affichage après chaque lot (pas ligne par
 * ligne, pour rester fluide même sur la lecture initiale d'un gros fichier).
 *
 * Chaque combat en cours est suivi indépendamment (voir FightWorking, indexé
 * par fightId) : la vue "Combat en cours" affiche le dernier combat actif
 * touché, mais les autres combats concurrents continuent d'accumuler leurs
 * propres dégâts/butin/tours en arrière-plan sans être écrasés. Les stats de
 * session (kamas/xp/combats) restent cumulatives sur toute la session.
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

  /** Nombre de tours et durée écoulée du combat en cours affiché (voir displayedFightId), recalculés à chaque lot de lignes traité. */
  readonly currentFightTurns = signal(1);
  readonly currentFightDurationMs = signal(0);
  /** fightId de tous les combats actuellement en cours, dans l'ordre où ils ont démarré — voir selectDisplayedFight() pour permettre à l'utilisateur de choisir lequel afficher quand plusieurs sont concurrents (multi-compte). */
  readonly activeFightIds = signal<number[]>([]);
  /** Choix explicite de l'utilisateur (onglets du panneau Combat) ; `null` = suivre automatiquement le dernier combat actif touché. Retombe silencieusement sur le suivi automatique si le combat choisi se termine. */
  readonly selectedFightId = signal<number | null>(null);
  /** Combat effectivement affiché par la vue "Combat en cours" (choix explicite s'il est toujours actif, sinon suivi automatique) — source de vérité pour currentFightTurns/currentFightDurationMs/damageByAttacker ET pour surligner l'onglet actif côté UI. */
  readonly displayedFightId = signal<number | null>(null);

  readonly xpByCharacter = signal<XpRow[]>([]);
  readonly damageByAttacker = signal<EntityDamageRow[]>([]);
  readonly fightHistory = signal<FightRecord[]>([]);
  /** Butin cumulé de tous les combats gagnés de la session (contrairement à `fightHistory`, pas
   * plafonné à MAX_FIGHT_HISTORY) — alimente la section butin de la modale recap de session. */
  readonly sessionLoot = signal<LootRow[]>([]);
  readonly purchaseHistory = signal<PurchaseRecord[]>([]);
  readonly tradeHistory = signal<TradeRecord[]>([]);
  readonly chatMessages = signal<ChatMessageEntry[]>([]);
  /** Suivi fusionné (ennemis vaincus + ressources obtenues), distingué par `kind`. */
  readonly watchlist = signal<WatchlistEntry[]>([]);

  private readonly xpMap = new Map<string, number>();
  /** Accumulateur du butin de session (clé = nom en minuscule) — voir sessionLoot. */
  private readonly sessionLootMap = new Map<string, LootRow>();
  private readonly chatBuffer: ChatMessageEntry[] = [];
  private readonly fightHistoryList: FightRecord[] = [];
  private readonly purchaseHistoryList: PurchaseRecord[] = [];
  private readonly tradeHistoryList: TradeRecord[] = [];
  /** Combats actuellement en cours, par fightId — voir FightWorking. */
  private readonly activeFights = new Map<number, FightWorking>();
  /** Combat affiché par la vue "Combat en cours" : le dernier combat actif touché par un événement. */
  private currentDisplayFightId: number | null = null;
  /** Horodatage de la dernière ligne traitée : sert à calculer la durée écoulée du combat affiché. */
  private lastLineTime: string | null = null;
  /** Vrai pendant le traitement du tout premier lot de lignes d'une connexion (contenu déjà présent dans le fichier) : les compteurs de suivi ne doivent pas être incrémentés pour cet historique déjà vécu. */
  private currentBatchIsInitialLoad = false;
  private nextPurchaseId = 1;
  private nextTradeId = 1;
  /** Perte de kamas en attente d'un ramassage d'objet immédiat (signature d'un achat) — voir registerLoot. */
  private pendingPurchase: { amount: number; timeMs: number } | null = null;

  /** Vrai si le dernier lot de lignes traité provenait d'un rechargement initial (historique déjà vécu) — à consulter par tout consommateur voulant éviter de réagir (ex. alerte sonore) à du contenu déjà connu. */
  wasLastBatchInitialLoad(): boolean {
    return this.currentBatchIsInitialLoad;
  }

  /** Choix explicite du combat à afficher (clic sur un onglet du panneau Combat) — `null` pour revenir au suivi automatique. */
  selectDisplayedFight(fightId: number | null): void {
    this.selectedFightId.set(fightId);
    this.publish();
  }

  constructor(
    private readonly logFileAccess: LogFileAccessService,
    private readonly persistence: PersistenceService,
    private readonly classifier: EntityClassifierService,
    private readonly profile: ProfileService,
    private readonly lootAlert: LootAlertService,
    private readonly roster: CharacterRosterService,
  ) {
    this.watchlist.set(this.loadWatchlist());
    this.logFileAccess.newLines$.subscribe(({ lines, isInitialLoad }) =>
      this.ingest(lines, isInitialLoad),
    );
  }

  private loadWatchlist(): WatchlistEntry[] {
    const stored = this.persistence.getJson<WatchlistEntry[]>(WATCHLIST_KEY);
    if (stored) return stored.map((w) => this.normalizeWatchlistEntry(w));
    // Migration ponctuelle depuis les deux anciennes listes séparées.
    const legacyEnemies = this.persistence.getJson<{ name: string; count: number }[]>(
      LEGACY_ENEMY_WATCHLIST_KEY,
    );
    const legacyItems = this.persistence.getJson<{ name: string; count: number }[]>(
      LEGACY_ITEM_WATCHLIST_KEY,
    );
    if (!legacyEnemies && !legacyItems) return [];
    const migrated: WatchlistEntry[] = [
      ...(legacyEnemies ?? []).map((w) => this.normalizeWatchlistEntry({ ...w, kind: 'enemy' as const })),
      ...(legacyItems ?? []).map((w) => this.normalizeWatchlistEntry({ ...w, kind: 'item' as const })),
    ];
    this.persistence.setJson(WATCHLIST_KEY, migrated);
    return migrated;
  }

  /** Complète les entrées persistées avant l'introduction du mode décompte (`mode`/`countdownTarget`
   * absents du JSON stocké, y compris pour la migration ponctuelle depuis les anciennes listes
   * séparées) — traitées comme le comportement historique ('up'). */
  private normalizeWatchlistEntry(
    entry: Partial<Pick<WatchlistEntry, 'mode' | 'countdownTarget'>> &
      Omit<WatchlistEntry, 'mode' | 'countdownTarget'>,
  ): WatchlistEntry {
    return {
      ...entry,
      mode: entry.mode ?? 'up',
      countdownTarget: entry.countdownTarget ?? 0,
    };
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

  /** Remet le compteur d'une seule entrée suivie à sa valeur de départ (0 en mode 'up',
   * `countdownTarget` en mode 'down') — sans la retirer de la liste. */
  resetWatchedCount(name: string): void {
    const updated = this.watchlist().map((w) =>
      w.name === name ? { ...w, count: this.startingCount(w) } : w,
    );
    this.watchlist.set(updated);
    this.persistence.setJson(WATCHLIST_KEY, updated);
  }

  /** Bascule le mode de comptage d'une entrée suivie ('up' <-> 'down') et réinitialise son
   * compteur à la valeur de départ correspondante — voir WatchlistCounterMode. */
  setWatchlistMode(name: string, mode: WatchlistCounterMode): void {
    const updated = this.watchlist().map((w) => {
      if (w.name !== name || w.mode === mode) return w;
      const next = { ...w, mode };
      return { ...next, count: this.startingCount(next) };
    });
    this.watchlist.set(updated);
    this.persistence.setJson(WATCHLIST_KEY, updated);
  }

  /** Change la valeur de départ du décompte d'une entrée suivie (mode 'down') et réinitialise
   * aussitôt son compteur courant sur cette nouvelle valeur. */
  setWatchlistCountdownTarget(name: string, target: number): void {
    const clamped = Math.max(0, Math.floor(Number.isFinite(target) ? target : 0));
    const updated = this.watchlist().map((w) =>
      w.name === name ? { ...w, countdownTarget: clamped, count: clamped } : w,
    );
    this.watchlist.set(updated);
    this.persistence.setJson(WATCHLIST_KEY, updated);
  }

  private startingCount(entry: WatchlistEntry): number {
    return entry.mode === 'down' ? entry.countdownTarget : 0;
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

    const resetCounts = this.watchlist().map((w) => ({ ...w, count: this.startingCount(w) }));
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
    // La toute dernière ligne d'un lot peut être le début d'un enregistrement
    // multi-lignes encore en attente (voir LogParser) : la traiter tout de
    // suite plutôt que d'attendre un futur lot qui peut tarder à arriver.
    const flushed = this.parser.flush();
    if (flushed) this.apply(flushed);
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
    this.sessionLootMap.clear();

    this.fightHistoryList.length = 0;
    this.purchaseHistoryList.length = 0;
    this.tradeHistoryList.length = 0;
    this.activeFights.clear();
    this.currentDisplayFightId = null;
    this.selectedFightId.set(null);
    this.lastLineTime = null;
    this.nextPurchaseId = 1;
    this.nextTradeId = 1;
    this.pendingPurchase = null;

    this.chatBuffer.length = 0;
    this.parser.reset();
  }

  private apply(entry: LogEntry): void {
    this.lastLineTime = entry.time;

    // Une perte de kamas immédiatement suivie d'un ramassage d'objet est la
    // signature d'un achat (marchand/HDV) : on l'enregistre en plus du
    // traitement habituel de la perte/du ramassage, sans le modifier.
    if (
      entry.kind === 'loot' &&
      this.pendingPurchase &&
      this.timeToMs(entry.time) - this.pendingPurchase.timeMs <= PURCHASE_WINDOW_MS
    ) {
      this.registerPurchase(this.pendingPurchase.amount, entry.item, entry.quantity, entry.time);
    }
    if (entry.kind !== 'kama-loss') this.pendingPurchase = null;

    switch (entry.kind) {
      case 'kama-gain':
        this.kamasEarned.update((v) => v + entry.amount);
        break;
      case 'kama-loss':
        this.kamasLost.update((v) => v + entry.amount);
        this.pendingPurchase = { amount: entry.amount, timeMs: this.timeToMs(entry.time) };
        break;
      case 'xp-gain':
        this.xpMap.set(entry.character, (this.xpMap.get(entry.character) ?? 0) + entry.amount);
        this.registerFightXp(entry.fightId, entry.character, entry.amount);
        break;
      case 'combat-start':
        break;
      case 'combat-end':
        this.finalizeFight(entry.fightId, entry.time, entry.result);
        break;
      case 'enemy-defeated':
        this.registerFightDefeat(entry.fightId, entry.name);
        break;
      case 'damage': {
        const working = entry.fightId !== null ? this.activeFights.get(entry.fightId) : undefined;
        if (working) this.addDamage(working.attackerMap, entry.attacker, entry);
        this.classifier.registerDamageTarget(entry.target, entry.attacker);
        break;
      }
      case 'loot':
        this.registerLoot(entry.item, entry.quantity, entry.fightId);
        break;
      case 'turn-marker': {
        const working = entry.fightId !== null ? this.activeFights.get(entry.fightId) : undefined;
        if (working) working.fight.turnCount += 1;
        break;
      }
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
        this.registerFighterJoin(entry.fightId, entry.name, entry.breed, entry.fighterId, entry.isControlledByAI);
        break;
      case 'trade-completed':
        this.registerTrade(entry.time, entry.sides);
        break;
      case 'combat-defeat-marker':
        break;
    }
  }

  private getOrCreateFight(fightId: number, time: string): FightWorking {
    let working = this.activeFights.get(fightId);
    if (!working) {
      working = {
        fight: new Fight(fightId, new Date(this.buildFullTimestampMs(time))),
        attackerMap: new Map(),
        defeatedNames: new Set(),
        fighterIdsSeen: new Set(),
      };
      this.activeFights.set(fightId, working);
    }
    this.currentDisplayFightId = fightId;
    return working;
  }

  private registerFighterJoin(
    fightId: number,
    name: string,
    breed: number,
    fighterId: number,
    isControlledByAI: boolean,
  ): void {
    const working = this.getOrCreateFight(fightId, this.lastLineTime ?? '00:00:00,000');
    if (!working.fighterIdsSeen.has(fighterId)) {
      working.fighterIdsSeen.add(fighterId);
      if (isControlledByAI) working.fight.enemies.push({ name, id: fighterId });
      else working.fight.allies.push({ name, breed });
    }
    this.classifier.registerFighterJoin(name, isControlledByAI);
    this.ensurePresent(working.attackerMap, name);
  }

  private registerFightXp(fightId: number | null, character: string, amount: number): void {
    const working = fightId !== null ? this.activeFights.get(fightId) : undefined;
    if (!working) return;
    const existing = working.fight.exp.find((e) => e.name === character);
    if (existing) existing.quantity += amount;
    else working.fight.exp.push({ name: character, quantity: amount });
  }

  private registerFightDefeat(fightId: number | null, name: string): void {
    const working = fightId !== null ? this.activeFights.get(fightId) : undefined;
    const key = name.toLowerCase();
    if (!working || working.defeatedNames.has(key)) return;
    working.defeatedNames.add(key);
    this.registerDefeat(name);
    this.ensurePresent(working.attackerMap, name);
  }

  /**
   * Le marqueur explicite "Vous avez été vaincu(e) !"/"Lancement de
   * l'occupation" n'apparaît pas toujours (ex. entraînement contre un
   * mannequin) : si tous les alliés ayant rejoint le combat sont KO à la fin,
   * c'est une défaite quoi qu'en dise ce marqueur.
   */
  private resolveFightResult(parsedResult: 'won' | 'lost', working: FightWorking): 'won' | 'lost' {
    if (parsedResult === 'lost') return 'lost';
    const allies = working.fight.allies;
    const allAlliesDefeated =
      allies.length > 0 &&
      allies.every((a) => working.defeatedNames.has(a.name.toLowerCase()));
    return allAlliesDefeated ? 'lost' : 'won';
  }

  private finalizeFight(fightId: number, time: string, parsedResult: 'won' | 'lost'): void {
    const working = this.activeFights.get(fightId);
    if (!working) return; // marqueur de fin dupliqué (ou reçu sans combat connu) : rien à clôturer.

    const result = this.resolveFightResult(parsedResult, working);
    if (result === 'won') {
      // Le dernier ennemi d'un combat (souvent le boss) meurt en même temps que
      // le combat se termine et n'a alors pas toujours droit à sa propre ligne
      // de mise hors-combat : sans ce filet, il n'est jamais crédité dans le
      // suivi des ennemis vaincus. Un combat gagné implique que tous les
      // ennemis ayant rejoint le combat sont morts.
      for (const enemy of working.fight.enemies) {
        this.registerFightDefeat(fightId, enemy.name);
      }
      this.combatsWon.update((v) => v + 1);
      for (const loot of working.fight.loots) {
        const key = loot.name.toLowerCase();
        const existing = this.sessionLootMap.get(key);
        if (existing) existing.quantity += loot.quantity;
        else this.sessionLootMap.set(key, { name: loot.name, quantity: loot.quantity });
      }
    } else {
      this.combatsLost.update((v) => v + 1);
    }

    working.fight.endDate = new Date(this.buildFullTimestampMs(time));
    const record: FightRecord = {
      id: fightId,
      time,
      fullTimestampMs: working.fight.startDate.getTime(),
      result,
      rows: this.buildEntityDamageRows(working.attackerMap, working.defeatedNames),
      loot: working.fight.loots.map((l) => ({ name: l.name, quantity: l.quantity })),
      turns: working.fight.turnCount,
      durationMs: Math.max(0, working.fight.endDate.getTime() - working.fight.startDate.getTime()),
      xp: working.fight.exp
        .map((e) => ({ name: e.name, amount: e.quantity }))
        .sort((a, b) => b.amount - a.amount),
    };
    this.fightHistoryList.unshift(record);
    this.fightHistoryList.length = Math.min(this.fightHistoryList.length, MAX_FIGHT_HISTORY);

    this.activeFights.delete(fightId);
    if (this.currentDisplayFightId === fightId) {
      const remaining = [...this.activeFights.keys()];
      this.currentDisplayFightId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
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

  private registerLoot(item: string, quantity: number, fightId: number | null): void {
    if (!this.currentBatchIsInitialLoad) {
      this.incrementWatched(item, quantity);
      const soundEntry = this.profile.findEnabledSoundItem(item);
      if (soundEntry) this.lootAlert.trigger(item, quantity);
    }

    const working = fightId !== null ? this.activeFights.get(fightId) : undefined;
    if (!working) return;
    const existing = working.fight.loots.find((l) => l.name.toLowerCase() === item.toLowerCase());
    if (existing) existing.quantity += quantity;
    else working.fight.loots.push({ name: item, id: this.lookupItemGfxId(item), quantity });
  }

  private lookupItemGfxId(name: string): number {
    return WAKFU_ITEMS_FR[normalizeWakfuName(name)]?.gfxId ?? 0;
  }

  /** Une perte de kamas suivie de très près par un ramassage d'objet est un achat (marchand/HDV) : n'affecte ni les kamas perdus ni le butin de combat, déjà comptabilisés par ailleurs. */
  private registerPurchase(amount: number, item: string, quantity: number, time: string): void {
    this.purchaseHistoryList.unshift({
      id: this.nextPurchaseId++,
      item,
      quantity,
      totalCost: amount,
      fullTimestampMs: this.buildFullTimestampMs(time),
    });
  }

  private registerTrade(
    time: string,
    sides: readonly [
      { playerName: string; items: TradeItemRow[]; kamas: number },
      { playerName: string; items: TradeItemRow[]; kamas: number },
    ],
  ): void {
    const [a, b] = sides;
    const aIsSelf = this.roster.hasCharacter(a.playerName);
    const bIsSelf = this.roster.hasCharacter(b.playerName);
    // Un échange entre deux personnages du roster déclaré (deux de ses
    // propres comptes) n'est pas un vrai échange avec un autre joueur : on
    // l'ignore plutôt que de l'enregistrer avec un "characterName" arbitraire.
    if (aIsSelf && bIsSelf) return;
    // Le personnage EN FACE est celui qui n'appartient pas au compte courant
    // (roster déclaré en page profil) ; si aucun des deux n'est reconnu, on
    // garde un choix stable plutôt que de ne rien enregistrer.
    const [self, other] = bIsSelf ? [b, a] : [a, b];
    this.tradeHistoryList.unshift({
      id: this.nextTradeId++,
      characterName: other.playerName,
      selfName: self.playerName,
      fullTimestampMs: this.buildFullTimestampMs(time),
      acquired: other.items,
      given: self.items,
      kamasAcquired: other.kamas,
      kamasGiven: self.kamas,
    });
  }

  private addWatched(rawName: string, kind: WatchlistKind): void {
    const name = rawName.trim();
    if (!name) return;
    const current = this.watchlist();
    if (current.some((w) => w.name.toLowerCase() === name.toLowerCase())) return;
    const updated = [...current, { name, count: 0, kind, mode: 'up' as const, countdownTarget: 0 }];
    this.watchlist.set(updated);
    this.persistence.setJson(WATCHLIST_KEY, updated);
  }

  /**
   * En mode 'up' (défaut) : incrémente le compteur, comportement historique inchangé. En mode
   * 'down' : décrémente vers 0 et déclenche l'alerte de suivi (son + toast + confettis, voir
   * LootAlertService/LootAlertComponent) exactement au moment où le compteur atteint 0 — jamais en
   * dessous (une entrée déjà à 0 en 'down' n'alerte plus tant qu'elle n'a pas été remontée via
   * resetWatchedCount/setWatchlistCountdownTarget).
   */
  private incrementWatched(name: string, by = 1): void {
    const normalized = name.trim().toLowerCase();
    const current = this.watchlist();
    const idx = current.findIndex((w) => w.name.toLowerCase() === normalized);
    if (idx === -1) return;
    const entry = current[idx];
    const updated = current.slice();
    if (entry.mode === 'down') {
      const next = Math.max(0, entry.count - by);
      updated[idx] = { ...entry, count: next };
      if (entry.count > 0 && next === 0) {
        this.lootAlert.trigger(entry.name, 0, { kind: entry.kind, reason: 'countdown' });
      }
    } else {
      updated[idx] = { ...entry, count: entry.count + by };
    }
    this.watchlist.set(updated);
    this.persistence.setJson(WATCHLIST_KEY, updated);
  }

  /** Combat à afficher : le choix explicite de l'utilisateur (onglets) tant qu'il reste actif, sinon le suivi automatique (dernier combat touché). */
  private resolveDisplayFightId(): number | null {
    const selected = this.selectedFightId();
    if (selected !== null && this.activeFights.has(selected)) return selected;
    return this.currentDisplayFightId;
  }

  private publish(): void {
    const displayFightId = this.resolveDisplayFightId();
    this.displayedFightId.set(displayFightId);
    this.activeFightIds.set([...this.activeFights.keys()]);
    const displayWorking = displayFightId !== null ? this.activeFights.get(displayFightId) : undefined;
    this.currentFightTurns.set(displayWorking?.fight.turnCount ?? 1);
    this.currentFightDurationMs.set(
      displayWorking && this.lastLineTime
        ? Math.max(
            0,
            this.buildFullTimestampMs(this.lastLineTime) - displayWorking.fight.startDate.getTime(),
          )
        : 0,
    );
    this.xpByCharacter.set(
      [...this.xpMap.entries()]
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount),
    );
    this.damageByAttacker.set(
      displayWorking
        ? this.buildEntityDamageRows(displayWorking.attackerMap, displayWorking.defeatedNames)
        : [],
    );
    this.fightHistory.set([...this.fightHistoryList]);
    this.sessionLoot.set([...this.sessionLootMap.values()]);
    this.purchaseHistory.set([...this.purchaseHistoryList]);
    this.tradeHistory.set([...this.tradeHistoryList]);
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
