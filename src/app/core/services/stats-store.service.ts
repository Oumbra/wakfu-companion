import { computed, inject, Injectable, signal } from '@angular/core';
import { ChatMessageEntry, DamageElement, DamageEntry, LogEntry } from '../models/log-entry.model';
import { Fight } from '../models/fight.model';
import { CatalogService } from '../api/catalog.service';
import { USER_DATA_KEYS } from '../data-access/user-data.keys';
import { UserDataService } from '../data-access/user-data.service';
import { CharacterRosterService } from './character-roster.service';
import { EntityClassifierService } from './entity-classifier.service';
import { GameServerService } from './game-server.service';
import { LogFileAccessService } from './log-file-access.service';
import { LogParser } from './log-parser';
import { LootAlertService } from './loot-alert.service';
import { PersistenceService } from './persistence.service';
import { ProfileService } from './profile.service';
import { HistorySyncService } from '../sync/history-sync.service';
import { fightDedupKey, purchaseDedupKey, tradeDedupKey } from '../sync/history-dedup.util';

/** @deprecated Réexportée pour les consommateurs historiques — les clés font
 * désormais autorité dans `core/data-access/user-data.keys.ts`. */
export const WATCHLIST_KEY = USER_DATA_KEYS.watchlist;
/** Anciennes clés (listes séparées), lues une seule fois pour migrer vers la liste fusionnée si besoin. */
const LEGACY_ENEMY_WATCHLIST_KEY = 'wakfu-enemy-watchlist';
const LEGACY_ITEM_WATCHLIST_KEY = 'wakfu-item-watchlist';
export const REASSIGN_HISTORY_KEY = USER_DATA_KEYS.damageReassignments;
export const ITEM_REASSIGN_HISTORY_KEY = USER_DATA_KEYS.itemReassignments;
const MAX_CHAT_MESSAGES = 2000;
const MAX_FIGHT_HISTORY = 30;
/** Borne haute du journal des réattributions persistées (voir reassignSpell/replayPersistedReassignments) — purement une garde-fou anti-croissance illimitée sur une très longue session, jamais atteinte en usage normal. */
const MAX_REASSIGNMENT_HISTORY = 500;
/** Miroir de MAX_REASSIGNMENT_HISTORY pour le journal de correction d'objet — voir reassignLootItem/reassignPurchaseItem/reassignTradeItem. */
const MAX_ITEM_REASSIGNMENT_HISTORY = 500;
/** Fenêtre de rapprochement entre une perte de kamas et le ramassage d'objet qui suit : signature d'un achat (marchand/HDV). Au-delà, on considère qu'il s'agit de deux événements sans rapport. */
const PURCHASE_WINDOW_MS = 2000;

interface SpellAgg {
  total: number;
  byElement: Map<DamageElement, number>;
  /** Ventilation par tour de jeu (voir Fight.turnCount, incrémenté par registerFightTurn) — clé =
   * numéro de tour (1-based), valeur = mêmes agrégats que `total`/`byElement` mais restreints à ce
   * tour. Alimente le switch Total/Tour de l'affichage (voir EntityDamageListComponent) ; `total`
   * ci-dessus reste la somme de tous les tours, jamais recalculée depuis cette ventilation. */
  byTurn: Map<number, { total: number; byElement: Map<DamageElement, number> }>;
}

/** Ventilation d'un sort restreinte à un seul tour — voir SpellAgg.byTurn. */
export interface SpellTurnBreakdown {
  turn: number;
  total: number;
  byElement: Partial<Record<DamageElement, number>>;
}

export interface SpellBreakdownRow {
  spell: string;
  total: number;
  byElement: Partial<Record<DamageElement, number>>;
  /** Trié par tour croissant, un élément par tour où ce sort a effectivement fait des dégâts (pas
   * une entrée par tour du combat) — voir SpellAgg.byTurn. Toujours vide pour un combat reconstruit
   * depuis l'archive du compte (voir HistoryArchiveService.toFightRecord) : le serveur ne stocke pas
   * cette ventilation, seule la session en cours (et l'historique local qui en dérive) la connaît. */
  byTurn: SpellTurnBreakdown[];
}

export interface EntityDamageRow {
  name: string;
  total: number;
  spells: SpellBreakdownRow[];
  defeated: boolean;
  /** Position (1-based) de cette ligne parmi les instances partageant ce nom, et nombre total
   * d'instances partageant ce nom (voir Fight.enemies/allies — plusieurs monstres, voire alliés,
   * peuvent porter le même nom). `instanceCount === 1` : une seule ligne pour ce nom, pas de
   * suffixe à afficher. Le log ne référence les dégâts/sorts que par nom (jamais par instance) :
   * chaque instance récupère ses propres dégâts/sorts via la file d'initiative du combat (voir
   * InitiativeSeat, resolveNextActor) dès qu'elle a été vue jouer au moins un sort — une instance
   * jamais vue jouer (morte avant son 1er tour) reste à 0, faute de mieux. */
  instanceIndex: number;
  instanceCount: number;
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
  /** Id Ankama de l'objet/monstre, capturé à l'ajout (voir WakfuSearchResult.id, résolu sans
   * ambiguïté par l'autocomplétion) — résolution non ambiguë de l'icône affichée en cas
   * d'homonymes (ex. "Larme d'Ogrest", deux objets distincts de même nom). `null` pour les
   * entrées persistées avant l'introduction de ce champ (voir normalizeWatchlistEntry, qui
   * tente un repli par nom au chargement) ou si le référentiel ne connaît pas ce nom. Le
   * comptage/la détection restent basés sur `name` (le log ne référence jamais un id) : seule
   * l'identification/l'affichage bénéficient de cet id. */
  catalogId: number | null;
}

export interface LootRow {
  name: string;
  /** Id Ankama résolu (automatiquement ou par correction manuelle, voir ItemPickerService), `null`
   * si non résolu — voir FightLoot.catalogId, même distinction avec un éventuel id d'icône. */
  catalogId: number | null;
  quantity: number;
}

/** Un achat individuel (objet, quantité, coût total, horodatage) : détecté quand une perte de kamas est immédiatement suivie d'un ramassage d'objet (voir registerPurchase). */
export interface PurchaseRecord {
  id: number;
  item: string;
  /** Id Ankama résolu — voir LootRow.catalogId. */
  catalogId: number | null;
  quantity: number;
  totalCost: number;
  /** Heure brute du log (`HH:MM:SS,mmm`) — seule partie réellement écrite par Wakfu, donc la
   * seule stable d'une relecture à l'autre : c'est elle qui entre dans la clé déterministe
   * d'envoi au compte (voir core/sync/history-event.model.ts), jamais `fullTimestampMs`, dont
   * la date vient de l'horloge système du jour de lecture. */
  time: string;
  fullTimestampMs: number;
}

export interface TradeItemRow {
  name: string;
  /** Id Ankama résolu — voir LootRow.catalogId. */
  catalogId: number | null;
  quantity: number;
}

/** Un échange individuel avec un autre joueur (objets/kamas acquis/cédés). `characterName` désigne le personnage EN FACE, `selfName` le personnage du compte courant (roster déclaré en page profil, voir CharacterRosterService) — un échange entre deux personnages du roster est ignoré (voir registerTrade), il n'y a donc jamais d'ambiguïté sur lequel des deux est "en face". */
export interface TradeRecord {
  id: number;
  characterName: string;
  selfName: string;
  /** Heure brute du log — voir `PurchaseRecord.time`. */
  time: string;
  fullTimestampMs: number;
  acquired: TradeItemRow[];
  given: TradeItemRow[];
  kamasAcquired: number;
  kamasGiven: number;
}

/** Une correction manuelle de réattribution enregistrée telle quelle (voir reassignSpell), persistée
 * pour être rejouée après chaque rechargement initial (voir replayPersistedReassignments) — sans
 * quoi une (re)connexion (F5, "Changer de fichier"...) reconstruit l'historique depuis zéro et perd
 * toute correction déjà appliquée (voir gating isInitialLoad, CLAUDE.md). */
interface PersistedReassignment {
  fightId: number;
  spellName: string;
  from: { name: string; instanceIndex: number };
  to: { name: string; instanceIndex: number };
}

/**
 * Une correction manuelle d'objet homonyme (voir ItemPickerService), persistée pour être rejouée
 * après chaque rechargement initial — même raison que PersistedReassignment. Clé de rapprochement
 * PAR CONTENU (jamais un id de session, remis à zéro à chaque reconstruction, ni un id d'archive,
 * synthétique — voir `archiveId()` dans history-archive.service.ts) : réutilise volontairement les
 * mêmes fonctions que le rapprochement session/compte (`fightDedupKey`/`purchaseDedupKey`/
 * `tradeDedupKey`, history-dedup.util.ts), calculables aussi bien depuis un enregistrement de
 * session QUE reconstruit depuis l'archive — exactement ce qui permet à la correction de s'appliquer
 * aux deux (voir CLAUDE.md, échange avec l'utilisateur).
 */
type PersistedItemReassignment =
  | {
      kind: 'loot';
      fightKey: string;
      itemName: string;
      /** Id (résolu, ou `null` si non résolu) de la ligne visée AU MOMENT de cette correction —
       * cible une ligne précise sans dépendre d'un rang positionnel dans le tableau (ancien
       * `occurrence`, abandonné : il dépendait implicitement de l'ordre du tableau de stockage ET
       * pouvait se désynchroniser de l'ordre affiché sous certains tris, voir CLAUDE.md, bug réel
       * corrigé). Unique par nom au sein d'un même combat grâce à l'invariant maintenu par
       * `reassignRowQuantity` : jamais deux lignes de même nom ET même `catalogId`. */
      sourceCatalogId: number | null;
      /** Quantité concernée par CETTE correction — peut être inférieure à la quantité totale de la
       * ligne visée (voir ItemPickerComponent, stepper de quantité) : la ligne est alors scindée
       * en deux (ou fusionnée dans une ligne existante de même rareté, voir reassignRowQuantity)
       * plutôt que réattribuée en bloc. */
      quantity: number;
      catalogId: number;
    }
  | {
      kind: 'purchase';
      purchaseKey: string;
      quantity: number;
      catalogId: number;
      /** Part du coût total (en kamas) concernée par CETTE correction, choisie manuellement par
       * l'utilisateur (voir ItemPickerRequest.totalKamas) — seulement quand `quantity` est
       * partielle, `undefined` sinon (achat réattribué en bloc, tout son coût le suit) ou si
       * l'utilisateur n'a pas touché le champ (repli sur le prorata automatique, voir
       * applyPurchaseReassign). Un achat n'est pas forcément linéaire en coût (remise de gros,
       * prix ayant varié entre deux achats agrégés le même jour), d'où la possibilité de l'ajuster
       * à la main plutôt que de toujours déduire ce montant de la quantité seule. */
      kamas?: number;
    }
  | {
      kind: 'tradeItem';
      tradeKey: string;
      direction: 'acquired' | 'given';
      itemName: string;
      /** Voir `loot.sourceCatalogId` — même principe, `trade_items` autorise plusieurs lignes
       * homonymes non fusionnées (contrairement à `fight_loot`), il faut donc plus que
       * `tradeKey|direction|itemName` pour cibler UNE ligne précise. */
      sourceCatalogId: number | null;
      quantity: number;
      catalogId: number;
    };

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
  /** Au moins une instance de ce nom (minuscule) a été vue vaincue — utilisé pour le flag "defeated"
   * par ligne agrégée (UI) et pour le repli "tous les alliés KO" de resolveFightResult(). */
  defeatedNames: Set<string>;
  /** Nombre d'instances déjà créditées comme vaincues, par nom (minuscule) — plafonné au nombre
   * réel d'instances de ce nom ayant rejoint le combat (voir Fight.enemies/allies, plusieurs
   * monstres pouvant partager un même nom). Permet de créditer le watchlist une fois par instance
   * réellement morte plutôt qu'une seule fois par nom (voir registerFightDefeat). */
  defeatedInstanceCounts: Map<string, number>;
  /** fighterId déjà vus (voir FighterJoinedEntry) : une jointure répétée (doublon multi-compte, resynchronisation) ne doit pas dupliquer l'entrée dans allies/enemies. */
  fighterIdsSeen: Set<number>;
  /** File d'initiative de ce combat (ordre de jeu détecté au fil de l'eau) — voir resolveNextActor(). */
  initiativeSeats: InitiativeSeat[];
  /** Index (dans initiativeSeats) du prochain siège attendu à jouer. */
  initiativeCursor: number;
  /** Dernier acteur (nom) ayant lancé un sort — permet d'ignorer les sorts consécutifs d'un même
   * acteur (toujours le même tour en cours, pas un nouveau passage dans la file). */
  lastTurnActor: string | null;
  /** Dernier siège résolu pour chaque nom (voir resolveNextActor) — sert à attribuer les dégâts
   * (attaquant identifié par nom seul dans le log) à la bonne instance quand le nom est partagé par
   * plusieurs combattants (voir case 'damage'). */
  lastResolvedSeatByName: Map<string, string>;
  /** Sièges (voir InitiativeSeat, PAS des noms bruts — c'est ce qui distingue correctement deux
   * combattants homonymes) ayant déjà joué au cours du tour courant — voir registerFightTurn : un
   * siège qui rejoue alors qu'il a déjà joué ce tour-ci signale que le tour a bouclé. */
  turnSeatsSeen: Set<string>;
}

/**
 * Un siège de la file d'initiative d'un combat : représente un combattant distinct dans l'ordre de
 * jeu réel (fixe pour toute la durée du combat, propriété du tour par tour Wakfu). `key` est un
 * identifiant synthétique stable pour toute la durée du combat — PAS le fighterId réel (le log ne
 * relie jamais une action de dégât/sort à un fighterId, seule la ligne de jointure [_FL_] le porte,
 * voir FighterJoinedEntry) : "Nom" si ce nom n'est porté que par un seul combattant du combat,
 * "Nom#i" sinon (i = ordre de découverte parmi les sièges de ce nom, voir resolveNextActor).
 */
interface InitiativeSeat {
  key: string;
  name: string;
  /** Nombre de tours consécutifs sautés (ce siège attendu n'a pas joué) sans avoir rejoué depuis —
   * voir resolveNextActor : à 2, le siège est considéré définitivement hors rotation. */
  consecutiveSkips: number;
  /** true dès que ce siège est sorti de la rotation (2 tours sautés d'affilée, très probablement
   * hors combat) : ignoré lors de la recherche du prochain siège, mais jamais retiré du tableau. */
  retired: boolean;
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
  /** Envoi de l'historique au compte (lot 8) — no-op complet en mode invité, voir HistorySyncService. */
  private readonly historySync = inject(HistorySyncService);

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
  /** Dernier mode (incrémental/décompte) choisi par l'utilisateur dans le formulaire d'ajout d'un
   * KPI — settings synchronisé (voir USER_DATA_KEYS.watchlistAddMode), PAS lié à une entrée
   * particulière : sert uniquement de valeur de départ au prochain formulaire d'ajout ouvert (voir
   * WatchlistTileController.resetAddForm/setAddMode). Persistant comme la watchlist elle-même
   * (jamais touché par resetSessionState — ce n'est pas un état dérivé du fichier de log). */
  readonly defaultAddMode = signal<WatchlistCounterMode>('up');

  private readonly xpMap = new Map<string, number>();
  /** Accumulateur du butin de session (clé = nom en minuscule) — voir sessionLoot. */
  private readonly sessionLootMap = new Map<string, LootRow>();
  private readonly chatBuffer: ChatMessageEntry[] = [];
  private readonly fightHistoryList: FightRecord[] = [];
  private readonly purchaseHistoryList: PurchaseRecord[] = [];
  private readonly tradeHistoryList: TradeRecord[] = [];
  /** Combats actuellement en cours, par fightId — voir FightWorking. */
  private readonly activeFights = new Map<number, FightWorking>();
  /** Journal des réattributions manuelles effectuées par l'utilisateur (voir reassignSpell),
   * persisté et rejoué après chaque rechargement initial pour ne jamais perdre une correction déjà
   * faite — voir PersistedReassignment. Volontairement PAS vidé par resetSessionState() (rejoué à
   * chaque isInitialLoad), seulement par resetStats() (remise à zéro explicite demandée par
   * l'utilisateur). */
  private readonly reassignmentHistory: PersistedReassignment[] = [];
  /** Journal des corrections manuelles d'objet homonyme (voir ItemPickerService/
   * reassignLootItem/reassignPurchaseItem/reassignTradeItem) — même politique que
   * `reassignmentHistory` (rejoué à chaque isInitialLoad, vidé uniquement par resetStats()). */
  private readonly itemReassignmentHistory: PersistedItemReassignment[] = [];
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
    /** Uniquement pour les deux anciennes clés de watchlist (migration
     * ponctuelle, voir `loadWatchlist`) : tout le reste passe par
     * `UserDataService`. */
    private readonly persistence: PersistenceService,
    private readonly classifier: EntityClassifierService,
    private readonly profile: ProfileService,
    private readonly lootAlert: LootAlertService,
    private readonly roster: CharacterRosterService,
    private readonly catalog: CatalogService,
    private readonly userData: UserDataService,
    private readonly gameServer: GameServerService,
  ) {
    // Une connexion survenue EN COURS de session ne doit pas laisser derrière
    // elle l'historique déjà reconstruit : au moment où la file s'active, elle
    // rappelle ceci pour récupérer tout ce qui est en mémoire. Sans risque de
    // doublon — c'est exactement ce que garantit la clé déterministe (lot 8).
    this.historySync.setReplaySource(() => this.replayHistoryToSync());
    this.watchlist.set(this.loadWatchlist());
    this.defaultAddMode.set(this.loadDefaultAddMode());
    this.reassignmentHistory.push(
      ...(this.userData.read<PersistedReassignment[]>('damageReassignments') ?? []),
    );
    this.itemReassignmentHistory.push(
      ...(this.userData.read<PersistedItemReassignment[]>('itemReassignments') ?? []),
    );
    // La watchlist est du SUIVI PERSISTANT (principe d'architecture n°2) : une
    // version venue d'un autre appareil la remplace intégralement, compteurs
    // compris — c'est exactement la sémantique voulue, et ça n'a rien à voir
    // avec le gating `isInitialLoad`, qui ne concerne que les incréments issus
    // du fichier de log.
    //
    // Pas d'équivalent pour `damageReassignments` : le journal des
    // réattributions est rejoué au fil de l'ingestion des combats, le
    // remplacer en pleine session appliquerait des corrections à des combats
    // déjà affichés. La nouvelle valeur est bien écrite sur le disque par le
    // dépôt, elle prendra effet au prochain démarrage.
    this.userData.onExternalChange('watchlist', () => this.watchlist.set(this.loadWatchlist()));
    this.userData.onExternalChange('watchlistAddMode', () =>
      this.defaultAddMode.set(this.loadDefaultAddMode()),
    );
    this.logFileAccess.newLines$.subscribe(({ lines, isInitialLoad }) =>
      this.ingest(lines, isInitialLoad),
    );
  }

  private loadWatchlist(): WatchlistEntry[] {
    const stored = this.userData.read<WatchlistEntry[]>('watchlist');
    if (stored) return stored.map((w) => this.normalizeWatchlistEntry(w));
    // Migration ponctuelle depuis les deux anciennes listes séparées.
    const legacyEnemies = this.persistence.getJson<{ name: string; count: number }[]>(
      LEGACY_ENEMY_WATCHLIST_KEY,
    );
    const legacyItems =
      this.persistence.getJson<{ name: string; count: number }[]>(LEGACY_ITEM_WATCHLIST_KEY);
    if (!legacyEnemies && !legacyItems) return [];
    const migrated: WatchlistEntry[] = [
      ...(legacyEnemies ?? []).map((w) =>
        this.normalizeWatchlistEntry({ ...w, kind: 'enemy' as const }),
      ),
      ...(legacyItems ?? []).map((w) =>
        this.normalizeWatchlistEntry({ ...w, kind: 'item' as const }),
      ),
    ];
    this.userData.write('watchlist', migrated);
    return migrated;
  }

  private loadDefaultAddMode(): WatchlistCounterMode {
    return this.userData.read<WatchlistCounterMode>('watchlistAddMode') === 'down' ? 'down' : 'up';
  }

  /** Mémorise le mode choisi (voir `defaultAddMode`) comme valeur de départ des prochains
   * formulaires d'ajout — appelé à chaque changement de mode dans ce formulaire (voir
   * WatchlistTileController.setAddMode), pas seulement à la création effective d'un KPI. */
  setDefaultAddMode(mode: WatchlistCounterMode): void {
    this.defaultAddMode.set(mode);
    this.userData.write('watchlistAddMode', mode);
  }

  /** Complète les entrées persistées avant l'introduction du mode décompte (`mode`/`countdownTarget`
   * absents du JSON stocké, y compris pour la migration ponctuelle depuis les anciennes listes
   * séparées) — traitées comme le comportement historique ('up'). Complète aussi `catalogId`
   * (absent des entrées persistées avant l'introduction de ce champ) par un repli best-effort par
   * nom : ne peut pas lever l'ambiguïté d'un homonyme pour une entrée déjà en place (l'id exact
   * choisi par l'utilisateur à l'époque n'a jamais été capturé), mais reste déterministe et vaut
   * mieux qu'aucun id du tout. */
  private normalizeWatchlistEntry(
    entry: Partial<Pick<WatchlistEntry, 'mode' | 'countdownTarget' | 'catalogId'>> &
      Omit<WatchlistEntry, 'mode' | 'countdownTarget' | 'catalogId'>,
  ): WatchlistEntry {
    const catalogId =
      entry.catalogId ??
      (entry.kind === 'enemy'
        ? (this.catalog.findWakfuMonsterEntry(entry.name)?.id ?? null)
        : (this.catalog.findWakfuItemEntry(entry.name)?.id ?? null));
    return {
      ...entry,
      mode: entry.mode ?? 'up',
      countdownTarget: entry.countdownTarget ?? 0,
      catalogId,
    };
  }

  addWatchedEnemy(rawName: string, catalogId: number | null = null): void {
    this.addWatched(rawName, 'enemy', catalogId);
  }

  addWatchedItem(rawName: string, catalogId: number | null = null): void {
    this.addWatched(rawName, 'item', catalogId);
  }

  /** Utilisé pour masquer l'invite "clic droit pour suivre" une fois l'entrée déjà suivie. */
  isWatched(rawName: string): boolean {
    const name = rawName.trim().toLowerCase();
    return this.watchlist().some((w) => w.name.toLowerCase() === name);
  }

  /** Entrée déjà suivie correspondant exactement à `(name, catalogId)`, ou `undefined` — utilisé
   * par les appelants qui doivent décider create-vs-update plutôt que toujours créer/écraser (ex.
   * RecipeQuantityModalComponent : cumuler la cible sur une entrée décompte déjà suivie plutôt que
   * l'écraser, voir increaseWatchlistCountdownTarget). */
  findWatchedEntry(name: string, catalogId?: number | null): WatchlistEntry | undefined {
    return this.watchlist().find((w) => this.matchesWatched(w, name, catalogId));
  }

  /**
   * Vrai si `w` est la ligne visée par `(name, catalogId)`. `catalogId` **non fourni**
   * (`undefined`, distinct d'un `null` explicite) : repli sur une correspondance par nom seul,
   * comportement historique — utilisé par les appelants qui n'ont pas connaissance d'un id
   * précis (ex. `recipe-quantity-modal`, un simple ajout name-only). `catalogId` fourni
   * (y compris `null`) : correspondance exacte sur la paire, nécessaire pour cibler UNE ligne
   * précise quand deux entrées partagent le même nom (catalogue avec homonymes, voir
   * `Larme d'Ogrest`) — sans quoi supprimer/modifier une des deux affecterait les deux à la fois.
   */
  private matchesWatched(w: WatchlistEntry, name: string, catalogId?: number | null): boolean {
    if (w.name !== name) return false;
    return catalogId === undefined ? true : w.catalogId === catalogId;
  }

  removeWatched(name: string, catalogId?: number | null): void {
    const updated = this.watchlist().filter((w) => !this.matchesWatched(w, name, catalogId));
    this.watchlist.set(updated);
    this.userData.write('watchlist', updated);
  }

  /** Remet le compteur d'une seule entrée suivie à sa valeur de départ (0 en mode 'up',
   * `countdownTarget` en mode 'down') — sans la retirer de la liste. */
  resetWatchedCount(name: string, catalogId?: number | null): void {
    const updated = this.watchlist().map((w) =>
      this.matchesWatched(w, name, catalogId) ? { ...w, count: this.startingCount(w) } : w,
    );
    this.watchlist.set(updated);
    this.userData.write('watchlist', updated);
  }

  /** Bascule le mode de comptage d'une entrée suivie ('up' <-> 'down') et réinitialise son
   * compteur à la valeur de départ correspondante — voir WatchlistCounterMode. */
  setWatchlistMode(name: string, mode: WatchlistCounterMode, catalogId?: number | null): void {
    const updated = this.watchlist().map((w) => {
      if (!this.matchesWatched(w, name, catalogId) || w.mode === mode) return w;
      const next = { ...w, mode };
      return { ...next, count: this.startingCount(next) };
    });
    this.watchlist.set(updated);
    this.userData.write('watchlist', updated);
  }

  /** Change la valeur de départ (cible) du décompte d'une entrée suivie et réinitialise aussitôt
   * son compteur courant sur cette nouvelle valeur — réservée à la CRÉATION du KPI (voir
   * WatchlistTileController.add()) : la cible est ensuite figée (comme le mode), au même titre
   * que la suppression/recréation est le seul moyen de la changer. Pour éditer le compteur courant
   * après coup sans toucher la cible, voir setWatchlistCurrentCount. */
  setWatchlistCountdownTarget(name: string, target: number, catalogId?: number | null): void {
    const clamped = Math.max(0, Math.floor(Number.isFinite(target) ? target : 0));
    const updated = this.watchlist().map((w) =>
      this.matchesWatched(w, name, catalogId)
        ? { ...w, countdownTarget: clamped, count: clamped }
        : w,
    );
    this.watchlist.set(updated);
    this.userData.write('watchlist', updated);
  }

  /** Édite la valeur ACTUELLE d'une entrée en mode décompte, sans toucher à sa cible — contrairement
   * à setWatchlistCountdownTarget (réservée à la création). Bornée à [0, countdownTarget] : le
   * compteur d'un décompte ne représente jamais plus que le nombre restant fixé au départ. Sans
   * effet sur une entrée en mode 'up' (rien à éditer manuellement dans ce mode, voir resetWatchedCount). */
  setWatchlistCurrentCount(name: string, count: number, catalogId?: number | null): void {
    const updated = this.watchlist().map((w) => {
      if (!this.matchesWatched(w, name, catalogId) || w.mode !== 'down') return w;
      const clamped = Math.max(
        0,
        Math.min(w.countdownTarget, Math.floor(Number.isFinite(count) ? count : 0)),
      );
      return { ...w, count: clamped };
    });
    this.watchlist.set(updated);
    this.userData.write('watchlist', updated);
  }

  /** Ajoute `amount` à LA FOIS à la cible et à la valeur actuelle d'une entrée décompte déjà
   * suivie — à la différence de setWatchlistCountdownTarget (qui remplace la cible et repart d'un
   * décompte plein), ceci CUMULE un nouveau besoin sur un décompte déjà entamé sans perdre
   * l'avancement déjà comptabilisé (ex. RecipeQuantityModalComponent, confirmer une 2e recette qui
   * redemande un objet déjà suivi : le besoin s'additionne). Sans effet si l'entrée n'existe pas
   * encore ou n'est pas en mode 'down' — l'appelant doit vérifier via findWatchedEntry et créer
   * l'entrée lui-même le cas échéant (voir confirm() de RecipeQuantityModalComponent). */
  increaseWatchlistCountdownTarget(name: string, amount: number, catalogId?: number | null): void {
    const delta = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
    if (delta === 0) return;
    const updated = this.watchlist().map((w) => {
      if (!this.matchesWatched(w, name, catalogId) || w.mode !== 'down') return w;
      return { ...w, countdownTarget: w.countdownTarget + delta, count: w.count + delta };
    });
    this.watchlist.set(updated);
    this.userData.write('watchlist', updated);
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
    this.userData.write('watchlist', updated);
  }

  /** Remet à zéro les compteurs de la session (conserve les noms suivis). */
  resetStats(): void {
    this.resetSessionState();
    this.publish();

    const resetCounts = this.watchlist().map((w) => ({ ...w, count: this.startingCount(w) }));
    this.watchlist.set(resetCounts);
    this.userData.write('watchlist', resetCounts);

    // Remise à zéro explicite demandée par l'utilisateur : les combats déjà réattribués sont
    // repartis avec l'historique qu'ils corrigeaient, inutile de les rejouer indéfiniment.
    this.reassignmentHistory.length = 0;
    this.userData.write('damageReassignments', this.reassignmentHistory);
    this.itemReassignmentHistory.length = 0;
    this.userData.write('itemReassignments', this.itemReassignmentHistory);
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
    // Rejoue les corrections déjà faites par l'utilisateur AVANT une (re)connexion : resetSessionState()
    // ci-dessus vient de reconstruire l'historique depuis zéro (voir gating isInitialLoad, CLAUDE.md),
    // sans quoi les combats concernés retrouveraient leur attribution automatique d'origine.
    if (isInitialLoad) this.replayPersistedReassignments();
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
        if (working) {
          // Le log ne référence l'attaquant que par nom : on l'attribue au dernier siège de la
          // file d'initiative résolu pour ce nom (voir resolveNextActor), qui distingue plusieurs
          // combattants homonymes — repli sur le nom brut si ce nom n'a encore jamais joué de sort
          // (ex. premier événement de dégâts du combat avant toute ligne "lance le sort").
          const seatKey = working.lastResolvedSeatByName.get(entry.attacker) ?? entry.attacker;
          this.addDamage(working.attackerMap, seatKey, entry, working.fight.turnCount);
        }
        this.classifier.registerDamageTarget(entry.target, entry.attacker);
        break;
      }
      case 'loot':
        this.registerLoot(entry.item, entry.quantity, entry.fightId);
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
        this.registerFightTurn(entry.fightId, entry.caster);
        break;
      case 'fighter-joined':
        this.registerFighterJoin(
          entry.fightId,
          entry.name,
          entry.breed,
          entry.fighterId,
          entry.isControlledByAI,
        );
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
        defeatedInstanceCounts: new Map(),
        fighterIdsSeen: new Set(),
        initiativeSeats: [],
        initiativeCursor: 0,
        lastTurnActor: null,
        lastResolvedSeatByName: new Map(),
        turnSeatsSeen: new Set(),
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
    // Un combattant non-IA qui appartient au roster déclaré identifie le compte
    // joué, donc le serveur (lot 7) — les autres joueurs présents dans le
    // combat sont ignorés par `noticeCharacter`.
    if (!isControlledByAI) this.gameServer.noticeCharacter(name);
    this.ensurePresent(working, name);
  }

  /**
   * "N secondes reportées pour le tour suivant" ne se déclenche qu'après un tour JOUEUR (jamais un
   * tour monstre IA) : signal structurellement incomplet pour compter les tours. Seul "X lance le
   * sort Y" est émis pour n'importe quel acteur (allié comme monstre), on s'en sert donc pour
   * construire au fil de l'eau la file d'initiative du combat (voir InitiativeSeat) — l'ordre de
   * jeu réel est fixe pour toute la durée d'un combat Wakfu (propriété du tour par tour), la
   * position d'un acteur dans cette file est donc stable d'un tour à l'autre.
   *
   * Le tour est compté par SIÈGE (voir turnSeatsSeen), pas par nom brut : un siège qui rejoue alors
   * qu'il a déjà joué ce tour-ci signale que le tour a bouclé. Compter par nom brut sur-compterait
   * les tours dès que 2 combattants homonymes jouent chacun une fois dans le même tour (le nom
   * "réapparaîtrait" avant d'avoir réellement bouclé) — c'est justement ce que résout la file
   * d'initiative en distinguant leurs sièges.
   */
  private registerFightTurn(fightId: number | null, actor: string): void {
    const working = fightId !== null ? this.activeFights.get(fightId) : undefined;
    if (!working) return;
    // Limite résiduelle assumée (irréductible vu le format du log, qui ne référence jamais un nom
    // par instance en dehors de la ligne de jointure) : si le tour d'une instance nommée X se
    // termine exactement au moment où le tour suivant démarre par une AUTRE instance de ce même nom
    // X (aucun autre acteur entre les deux, ex. 2 monstres homonymes placés côte à côte dans l'ordre
    // de jeu), rien ne permet de distinguer ce cas d'un simple 2ᵉ sort de la même instance dans son
    // propre tour : les deux sont alors fusionnés sur le même siège.
    if (working.lastTurnActor === actor) return; // même tour en cours (plusieurs sorts d'affilée).

    const seatKey = this.resolveNextActor(working, actor);
    working.lastTurnActor = actor;
    working.lastResolvedSeatByName.set(actor, seatKey);

    if (working.turnSeatsSeen.has(seatKey)) {
      working.fight.turnCount += 1;
      working.turnSeatsSeen.clear();
    }
    working.turnSeatsSeen.add(seatKey);
  }

  /**
   * Trouve, à partir du curseur, le plus proche siège actif (non retiré) portant ce nom et avance
   * la file jusqu'à lui — les sièges actifs sautés au passage (attendus avant lui mais n'ayant pas
   * joué) voient leur compteur de tours sautés incrémenté, et sont considérés définitivement hors
   * rotation dès 2 tours sautés d'affilée (très probablement hors combat, cf. énoncé du problème :
   * un "joker temporaire" qui se confirme se transforme en retrait définitif).
   *
   * Tant que ce nom n'a pas encore autant de sièges que d'instances connues ayant rejoint le combat
   * (voir countNameInstances), la recherche ne boucle PAS par la fin de la file : une occurrence de
   * ce nom ne peut alors être reconnue comme une instance déjà vue QUE si elle se trouve sans avoir
   * à franchir la fin de la file actuelle — sinon impossible de savoir s'il s'agit d'une instance
   * déjà vue qui rejoue ou d'une instance encore jamais vue, on préfère alors créer un nouveau siège
   * (repli sûr : au pire une instance jamais résolue reste à 0 dégât, voir buildEntityDamageRows).
   * Une fois toutes les instances connues dotées d'un siège, la recherche redevient circulaire.
   *
   * Si aucun siège actif existant ne porte ce nom, il s'agit d'une instance jamais vue jouer
   * jusqu'ici : un nouveau siège est créé et inséré à la position du curseur (meilleure estimation
   * disponible de sa place réelle dans l'ordre de jeu). "Nom" si ce nom n'est porté que par un seul
   * combattant du combat, "Nom#i" sinon (i = ordre de découverte parmi les sièges de ce nom) —
   * jamais le fighterId réel, que le log ne relie à aucune ligne d'action (voir InitiativeSeat).
   */
  private resolveNextActor(working: FightWorking, name: string): string {
    const seats = working.initiativeSeats;
    const seatCount = seats.length;
    const cursor = working.initiativeCursor;
    const instanceCount = this.countNameInstances(working, name.toLowerCase()) || 1;
    const existingSeatsForName = seats.reduce((n, s) => n + (s.name === name ? 1 : 0), 0);
    const allowWrap = existingSeatsForName >= instanceCount;
    const maxOffset = allowWrap ? seatCount : seatCount - cursor;

    for (let offset = 0; offset < maxOffset; offset++) {
      const idx = (cursor + offset) % seatCount;
      const seat = seats[idx];
      if (seat.retired || seat.name !== name) continue;

      for (let skipOffset = 0; skipOffset < offset; skipOffset++) {
        const skipped = seats[(cursor + skipOffset) % seatCount];
        if (skipped.retired) continue;
        skipped.consecutiveSkips += 1;
        if (skipped.consecutiveSkips >= 2) skipped.retired = true;
      }

      seat.consecutiveSkips = 0;
      working.initiativeCursor = (idx + 1) % seatCount;
      return seat.key;
    }

    const key = instanceCount <= 1 ? name : `${name}#${existingSeatsForName + 1}`;
    seats.splice(cursor, 0, { key, name, consecutiveSkips: 0, retired: false });
    // Pas de modulo ici (contrairement à la branche "trouvé" ci-dessus) : la file grandit encore
    // pendant la découverte initiale (1er tour), `cursor` doit alors simplement suivre la queue au
    // fil des insertions successives (cursor === seats.length tant qu'on ne fait qu'ajouter) —
    // moduler prématurément par la longueur (souvent 1 juste après la toute 1ʳᵉ insertion) ferait
    // revenir le curseur à 0 et casserait la position d'insertion des sièges suivants.
    working.initiativeCursor = cursor + 1;
    return key;
  }

  private registerFightXp(fightId: number | null, character: string, amount: number): void {
    const working = fightId !== null ? this.activeFights.get(fightId) : undefined;
    if (!working) return;
    const existing = working.fight.exp.find((e) => e.name === character);
    if (existing) existing.quantity += amount;
    else working.fight.exp.push({ name: character, quantity: amount });
  }

  /** Nombre d'instances (voir Fight.enemies/allies) portant ce nom (minuscule) parmi les deux camps. */
  private countNameInstances(working: FightWorking, key: string): number {
    let count = 0;
    for (const e of working.fight.enemies) if (e.name.toLowerCase() === key) count++;
    for (const a of working.fight.allies) if (a.name.toLowerCase() === key) count++;
    return count;
  }

  /**
   * Plusieurs monstres (voire, en théorie, alliés) peuvent partager le même nom : chaque marqueur
   * "X est KO/hors-combat !" ne doit créditer qu'une instance de ce nom à la fois, jusqu'au nombre
   * réel d'instances ayant rejoint le combat — au-delà, un marqueur supplémentaire pour ce nom est
   * considéré redondant (ex. KO puis hors-combat pour la même instance) et ignoré.
   */
  private registerFightDefeat(fightId: number | null, name: string): void {
    const working = fightId !== null ? this.activeFights.get(fightId) : undefined;
    if (!working) return;
    const key = name.toLowerCase();
    working.defeatedNames.add(key);
    this.ensurePresent(working, name);

    const alreadyCredited = working.defeatedInstanceCounts.get(key) ?? 0;
    const instanceCount = this.countNameInstances(working, key) || 1;
    if (alreadyCredited >= instanceCount) return;
    working.defeatedInstanceCounts.set(key, alreadyCredited + 1);
    this.registerDefeat(name);
  }

  /** Vrai si toutes les instances (par nom, voir countNameInstances) de la liste donnée sont créditées comme vaincues. */
  private allInstancesDefeated(
    entities: ReadonlyArray<{ name: string }>,
    working: FightWorking,
  ): boolean {
    const perName = new Map<string, number>();
    for (const e of entities) {
      const key = e.name.toLowerCase();
      perName.set(key, (perName.get(key) ?? 0) + 1);
    }
    for (const [key, count] of perName) {
      if ((working.defeatedInstanceCounts.get(key) ?? 0) < count) return false;
    }
    return true;
  }

  /**
   * Les marqueurs explicites "Vous avez été vaincu(e) !" (transitoire : simple KO, le personnage
   * peut être relevé) et "Lancement de l'occupation" (diffusé en fin de TOUT combat, gagné ou
   * perdu) ne suffisent pas à déterminer une défaite. Cascade de signaux, du plus fiable au moins
   * fiable :
   *  1) Wakfu ne verse de l'XP de combat qu'en cas de victoire : dès qu'un gain d'XP a été
   *     enregistré pour ce combat, c'est une victoire.
   *  2) Repli : tous les ennemis ayant rejoint le combat (par instance, voir Fight.enemies) sont
   *     morts => victoire, même sans XP (ex. combat n'en accordant pas).
   *  3) Repli : tous les alliés ayant rejoint le combat sont KO à la fin => défaite, quoi qu'en
   *     dise le marqueur explicite (absent par ex. en entraînement contre un mannequin).
   *  4) Dernier repli : le marqueur explicite du parser.
   */
  private resolveFightResult(parsedResult: 'won' | 'lost', working: FightWorking): 'won' | 'lost' {
    if (working.fight.exp.length > 0) return 'won';

    const enemies = working.fight.enemies;
    if (enemies.length > 0 && this.allInstancesDefeated(enemies, working)) return 'won';

    const allies = working.fight.allies;
    const allAlliesDefeated =
      allies.length > 0 && allies.every((a) => working.defeatedNames.has(a.name.toLowerCase()));
    if (allAlliesDefeated) return 'lost';

    return parsedResult;
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
        else
          this.sessionLootMap.set(key, {
            name: loot.name,
            catalogId: loot.catalogId,
            quantity: loot.quantity,
          });
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
      rows: this.buildEntityDamageRows(working),
      loot: working.fight.loots.map((l) => ({
        name: l.name,
        catalogId: l.catalogId,
        quantity: l.quantity,
      })),
      turns: working.fight.turnCount,
      durationMs: Math.max(0, working.fight.endDate.getTime() - working.fight.startDate.getTime()),
      xp: working.fight.exp
        .map((e) => ({ name: e.name, amount: e.quantity }))
        .sort((a, b) => b.amount - a.amount),
    };
    this.fightHistoryList.unshift(record);
    // Envoi au compte AVANT le plafonnement en mémoire : `MAX_FIGHT_HISTORY`
    // borne ce que l'appareil garde affiché, pas ce que le compte archive —
    // c'est tout l'objet de ce lot (« historique illimité »).
    this.historySync.recordFight(record);
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
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), +h, +m, +s, +ms).getTime();
  }

  private timeToMs(time: string): number {
    const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(time);
    if (!match) return 0;
    const [, h, m, s, ms] = match;
    return ((+h * 60 + +m) * 60 + +s) * 1000 + +ms;
  }

  /**
   * Garantit une ligne à 0 dégât pour un nom SANS instance ambiguë (voir InitiativeSeat), sans
   * écraser des dégâts déjà enregistrés. Un nom partagé par plusieurs combattants n'est volontairement
   * PAS créé ici : ses lignes (une par instance) sont reconstruites par buildEntityDamageRows() à
   * partir de Fight.enemies/allies, la clé exacte ("Nom#i") n'étant connue qu'une fois l'instance
   * résolue par la file d'initiative (voir resolveNextActor) — créer ici une entrée "Nom" brute en
   * plus produirait une ligne fantôme en double des lignes par instance.
   */
  private ensurePresent(working: FightWorking, name: string): void {
    const instanceCount = this.countNameInstances(working, name.toLowerCase()) || 1;
    if (instanceCount > 1) return;
    if (!working.attackerMap.has(name)) working.attackerMap.set(name, new Map());
  }

  private addDamage(
    map: Map<string, Map<string, SpellAgg>>,
    key: string,
    entry: DamageEntry,
    turn: number,
  ): void {
    let spells = map.get(key);
    if (!spells) {
      spells = new Map();
      map.set(key, spells);
    }
    let agg = spells.get(entry.spell);
    if (!agg) {
      agg = { total: 0, byElement: new Map(), byTurn: new Map() };
      spells.set(entry.spell, agg);
    }
    agg.total += entry.amount;
    agg.byElement.set(entry.element, (agg.byElement.get(entry.element) ?? 0) + entry.amount);

    let turnAgg = agg.byTurn.get(turn);
    if (!turnAgg) {
      turnAgg = { total: 0, byElement: new Map() };
      agg.byTurn.set(turn, turnAgg);
    }
    turnAgg.total += entry.amount;
    turnAgg.byElement.set(
      entry.element,
      (turnAgg.byElement.get(entry.element) ?? 0) + entry.amount,
    );
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
      if (soundEntry) this.lootAlert.trigger(item, quantity, { id: soundEntry.catalogId });
    }

    const working = fightId !== null ? this.activeFights.get(fightId) : undefined;
    if (!working) return;
    const existing = working.fight.loots.find((l) => l.name.toLowerCase() === item.toLowerCase());
    if (existing) existing.quantity += quantity;
    else
      working.fight.loots.push({
        name: item,
        id: this.lookupItemGfxId(item),
        catalogId: this.catalog.findWakfuItemEntry(item)?.id ?? null,
        quantity,
      });
  }

  /** SYNCHRONE (chemin chaud, voir CatalogService) : simple lecture de l'index déjà en mémoire, à
   * chaque ramassage d'objet. Sans conséquence observable si le catalogue n'est pas encore chargé
   * au tout premier lancement (repli sur 0) : `FightLoot.id` n'est actuellement lu par aucun
   * composant d'affichage (voir `loot: LootRow[]`, qui ne conserve que `{name, quantity}`). */
  private lookupItemGfxId(name: string): number {
    return this.catalog.findWakfuItemEntry(name)?.gfxId ?? 0;
  }

  /** Une perte de kamas suivie de très près par un ramassage d'objet est un achat (marchand/HDV) : n'affecte ni les kamas perdus ni le butin de combat, déjà comptabilisés par ailleurs. */
  private registerPurchase(amount: number, item: string, quantity: number, time: string): void {
    const record: PurchaseRecord = {
      id: this.nextPurchaseId++,
      item,
      catalogId: this.catalog.findWakfuItemEntry(item)?.id ?? null,
      quantity,
      totalCost: amount,
      time,
      fullTimestampMs: this.buildFullTimestampMs(time),
    };
    this.purchaseHistoryList.unshift(record);
    this.historySync.recordPurchase(record);
  }

  private registerTrade(
    time: string,
    sides: readonly [
      { playerName: string; items: { name: string; quantity: number }[]; kamas: number },
      { playerName: string; items: { name: string; quantity: number }[]; kamas: number },
    ],
  ): void {
    const [a, b] = sides;
    const aIsSelf = this.roster.hasCharacter(a.playerName);
    const bIsSelf = this.roster.hasCharacter(b.playerName);
    // Un échange suffit à identifier le compte joué : une session purement
    // marchande (aucun combat) renseigne ainsi le serveur actif elle aussi.
    this.gameServer.noticeCharacter(aIsSelf ? a.playerName : b.playerName);
    // Un échange entre deux personnages du roster déclaré (deux de ses
    // propres comptes) n'est pas un vrai échange avec un autre joueur : on
    // l'ignore plutôt que de l'enregistrer avec un "characterName" arbitraire.
    if (aIsSelf && bIsSelf) return;
    // Le personnage EN FACE est celui qui n'appartient pas au compte courant
    // (roster déclaré en page profil) ; si aucun des deux n'est reconnu, on
    // garde un choix stable plutôt que de ne rien enregistrer.
    const [self, other] = bIsSelf ? [b, a] : [a, b];
    const resolveItems = (items: { name: string; quantity: number }[]): TradeItemRow[] =>
      items.map((item) => ({
        name: item.name,
        catalogId: this.catalog.findWakfuItemEntry(item.name)?.id ?? null,
        quantity: item.quantity,
      }));
    const record: TradeRecord = {
      id: this.nextTradeId++,
      characterName: other.playerName,
      selfName: self.playerName,
      time,
      fullTimestampMs: this.buildFullTimestampMs(time),
      acquired: resolveItems(other.items),
      given: resolveItems(self.items),
      kamasAcquired: other.kamas,
      kamasGiven: self.kamas,
    };
    this.tradeHistoryList.unshift(record);
    this.historySync.recordTrade(record);
  }

  /**
   * Refuse un doublon : même id (`catalogId`) déjà suivi, ou — quand l'un des deux (le candidat
   * ou une entrée déjà suivie) n'a pas d'id résolu — même nom, par prudence (impossible de
   * garantir qu'il s'agit d'objets/monstres distincts sans id des deux côtés). Deux entrées de
   * même nom mais d'id différent (ex. les deux "Larme d'Ogrest") peuvent donc coexister.
   */
  private addWatched(rawName: string, kind: WatchlistKind, catalogId: number | null): void {
    const name = rawName.trim();
    if (!name) return;
    const current = this.watchlist();
    const normalized = name.toLowerCase();
    const isDuplicate = current.some((w) => {
      if (w.kind !== kind) return false;
      if (catalogId !== null && w.catalogId !== null) return w.catalogId === catalogId;
      return w.name.toLowerCase() === normalized;
    });
    if (isDuplicate) return;
    const updated = [
      ...current,
      { name, count: 0, kind, mode: 'up' as const, countdownTarget: 0, catalogId },
    ];
    this.watchlist.set(updated);
    this.userData.write('watchlist', updated);
  }

  /**
   * En mode 'up' (défaut) : incrémente le compteur, comportement historique inchangé. En mode
   * 'down' : décrémente vers 0 et déclenche l'alerte de suivi (son + toast + confettis, voir
   * LootAlertService/LootAlertComponent) exactement au moment où le compteur atteint 0 — jamais en
   * dessous (une entrée déjà à 0 en 'down' n'alerte plus tant qu'elle n'a pas été remontée via
   * resetWatchedCount/setWatchlistCountdownTarget).
   *
   * Applique le changement à TOUTES les entrées partageant ce nom, pas seulement la première
   * trouvée : le log ne référence un ramassage/une mise KO que par nom, jamais par id (voir
   * addWatched) — quand deux entrées homonymes d'id différent sont suivies simultanément
   * (ex. les deux "Larme d'Ogrest"), impossible de savoir laquelle des deux est réellement
   * concernée. Créditer les deux est plus honnête que d'en créditer une arbitrairement et de
   * laisser l'autre bloquée à 0 indéfiniment.
   */
  private incrementWatched(name: string, by = 1): void {
    const normalized = name.trim().toLowerCase();
    const current = this.watchlist();
    const matchingIndexes = current.reduce<number[]>((acc, w, i) => {
      if (w.name.toLowerCase() === normalized) acc.push(i);
      return acc;
    }, []);
    if (matchingIndexes.length === 0) return;
    const updated = current.slice();
    for (const idx of matchingIndexes) {
      const entry = updated[idx];
      if (entry.mode === 'down') {
        const next = Math.max(0, entry.count - by);
        updated[idx] = { ...entry, count: next };
        if (entry.count > 0 && next === 0) {
          this.lootAlert.trigger(entry.name, 0, {
            kind: entry.kind,
            reason: 'countdown',
            id: entry.catalogId,
          });
        }
      } else {
        updated[idx] = { ...entry, count: entry.count + by };
      }
    }
    this.watchlist.set(updated);
    this.userData.write('watchlist', updated);
  }

  /**
   * Repasse à la file de synchronisation tout l'historique déjà reconstruit
   * (lot 8) — appelé quand la connexion aboutit alors que le fichier de log est
   * déjà lu. La file dédoublonne par clé de contenu, un événement déjà envoyé
   * n'est donc pas renvoyé.
   */
  private replayHistoryToSync(): void {
    for (const record of this.fightHistoryList) this.historySync.recordFight(record);
    for (const record of this.purchaseHistoryList) this.historySync.recordPurchase(record);
    for (const record of this.tradeHistoryList) this.historySync.recordTrade(record);
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
    const displayWorking =
      displayFightId !== null ? this.activeFights.get(displayFightId) : undefined;
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
    this.damageByAttacker.set(displayWorking ? this.buildEntityDamageRows(displayWorking) : []);
    this.fightHistory.set([...this.fightHistoryList]);
    this.sessionLoot.set([...this.sessionLootMap.values()]);
    this.purchaseHistory.set([...this.purchaseHistoryList]);
    this.tradeHistory.set([...this.tradeHistoryList]);
    this.chatMessages.set([...this.chatBuffer]);
  }

  /**
   * Une ligne par instance réellement rejointe (voir Fight.enemies/allies), pas par nom : plusieurs
   * monstres (voire alliés) peuvent partager un même nom (voir countNameInstances). Chaque instance
   * porte désormais ses propres dégâts/sorts quand la file d'initiative (voir resolveNextActor) a pu
   * l'identifier au moins une fois (clé "Nom#i" dans attackerMap) — une instance jamais vue jouer de
   * sort (morte avant son 1er tour, ou dégâts reçus uniquement) reste à 0, faute de mieux. Seul le
   * statut KO (`defeatedInstanceCounts`) reste indépendant de la file d'initiative (signal explicite
   * du parser, plus fiable).
   */
  private buildEntityDamageRows(working: FightWorking): EntityDamageRow[] {
    const instanceCountByName = new Map<string, number>();
    for (const e of working.fight.enemies) {
      instanceCountByName.set(e.name, (instanceCountByName.get(e.name) ?? 0) + 1);
    }
    for (const a of working.fight.allies) {
      instanceCountByName.set(a.name, (instanceCountByName.get(a.name) ?? 0) + 1);
    }
    // Noms présents dans attackerMap mais absents de Fight.enemies/allies (ex. invocation d'allié,
    // jamais rejointe via [_FL_]) : à ajouter aussi, traités comme instance unique (clé = nom brut,
    // jamais suffixée "#i" — voir resolveNextActor, qui ne suffixe que si countNameInstances > 1).
    const names = new Set(instanceCountByName.keys());
    for (const key of working.attackerMap.keys()) names.add(this.seatKeyToName(key));

    const buildSpellRows = (spells: Map<string, SpellAgg> | undefined): SpellBreakdownRow[] =>
      spells
        ? [...spells.entries()]
            .map(([spell, agg]) => ({
              spell,
              total: agg.total,
              byElement: Object.fromEntries(agg.byElement) as Partial<
                Record<DamageElement, number>
              >,
              byTurn: [...agg.byTurn.entries()]
                .map(([turn, t]) => ({
                  turn,
                  total: t.total,
                  byElement: Object.fromEntries(t.byElement) as Partial<
                    Record<DamageElement, number>
                  >,
                }))
                .sort((a, b) => a.turn - b.turn),
            }))
            .sort((a, b) => b.total - a.total)
        : [];

    const rows: EntityDamageRow[] = [];
    for (const name of names) {
      const instanceCount = instanceCountByName.get(name) ?? 1;
      const defeatedCount = working.defeatedInstanceCounts.get(name.toLowerCase()) ?? 0;

      for (let instanceIndex = 1; instanceIndex <= instanceCount; instanceIndex++) {
        const key = instanceCount <= 1 ? name : `${name}#${instanceIndex}`;
        const spellRows = buildSpellRows(working.attackerMap.get(key));
        const total = spellRows.reduce((sum, row) => sum + row.total, 0);
        rows.push({
          name,
          total,
          spells: spellRows,
          defeated: instanceIndex <= defeatedCount,
          instanceIndex,
          instanceCount,
        });
      }
    }
    return rows.sort((a, b) => b.total - a.total);
  }

  /** Retire le suffixe "#i" d'une clé de siège (voir InitiativeSeat) pour retrouver le nom réel —
   * ce suffixe n'apparaît jamais dans un nom Wakfu, il n'est produit que par resolveNextActor(). */
  private seatKeyToName(key: string): string {
    const hashIdx = key.lastIndexOf('#');
    if (hashIdx === -1) return key;
    return /^\d+$/.test(key.slice(hashIdx + 1)) ? key.slice(0, hashIdx) : key;
  }

  /**
   * Instances (alliés/ennemis) vers lesquelles une attaque peut être réattribuée (voir
   * reassignSpell) — combat en cours (recalculé depuis attackerMap) ou déjà terminé (rows déjà
   * figées dans l'historique). Classées par camp via EntityClassifierService (même heuristique que
   * l'affichage), pas par la position d'origine de la ligne.
   */
  getReassignCandidates(fightId: number): {
    allies: EntityDamageRow[];
    enemies: EntityDamageRow[];
  } {
    const working = this.activeFights.get(fightId);
    const rows = working
      ? this.buildEntityDamageRows(working)
      : (this.fightHistoryList.find((f) => f.id === fightId)?.rows ?? []);
    const allies: EntityDamageRow[] = [];
    const enemies: EntityDamageRow[] = [];
    for (const row of rows) {
      (this.classifier.classify(row.name) === 'ally' ? allies : enemies).push(row);
    }
    return { allies, enemies };
  }

  /**
   * Réattribue une attaque (un sort et tous ses dégâts déjà enregistrés) d'une instance vers une
   * autre — correction manuelle d'une attribution automatique erronée (voir resolveNextActor,
   * ambiguïté inhérente dès que plusieurs combattants partagent un nom, le log ne référençant
   * jamais une action par instance). Fusionne (incrémente) si la cible a déjà un sort du même nom,
   * plutôt que d'écraser. Fonctionne aussi bien sur un combat en cours (attackerMap) que déjà
   * terminé (FightRecord.rows figées dans l'historique).
   */
  reassignSpell(
    fightId: number,
    spellName: string,
    from: { name: string; instanceIndex: number },
    to: { name: string; instanceIndex: number },
  ): void {
    this.applyReassign(fightId, spellName, from, to);

    this.reassignmentHistory.push({ fightId, spellName, from, to });
    if (this.reassignmentHistory.length > MAX_REASSIGNMENT_HISTORY) {
      this.reassignmentHistory.splice(
        0,
        this.reassignmentHistory.length - MAX_REASSIGNMENT_HISTORY,
      );
    }
    this.userData.write('damageReassignments', this.reassignmentHistory);
  }

  private applyReassign(
    fightId: number,
    spellName: string,
    from: { name: string; instanceIndex: number },
    to: { name: string; instanceIndex: number },
  ): void {
    const working = this.activeFights.get(fightId);
    if (working) {
      // Combat encore en cours : rien à renvoyer, il ne partira au compte qu'à
      // sa clôture (finalizeFight), donc déjà corrigé.
      this.reassignLiveSpell(working, spellName, from, to);
      return;
    }
    this.reassignHistoricalSpell(fightId, spellName, from, to);
    // Combat déjà clôturé, donc déjà envoyé (ou en file) : le remettre en file
    // avec sa ventilation corrigée. Même clé déterministe, donc aucun doublon —
    // seul le détail du combat est rafraîchi côté compte (voir
    // `fight_participants`, écrit en ON CONFLICT DO UPDATE).
    const corrected = this.fightHistoryList.find((record) => record.id === fightId);
    if (corrected) this.historySync.recordFight(corrected);
  }

  /** Rejoue tout le journal des réattributions persistées (voir reassignSpell) — appelé après chaque
   * lot initial de (re)connexion, une fois l'historique du fichier entièrement reconstruit. Chaque
   * entrée est rejouée dans son ordre d'origine : une chaîne de corrections successives sur le même
   * sort (A→B puis B→C) ne fonctionne que rejouée dans cet ordre. applyReassign() est un no-op
   * silencieux si l'entité/le sort visé n'existe plus (ex. combat absent de ce fichier), donc sans
   * risque à rejouer sur un historique qui ne correspond plus. */
  private replayPersistedReassignments(): void {
    for (const entry of this.reassignmentHistory) {
      this.applyReassign(entry.fightId, entry.spellName, entry.from, entry.to);
    }
    // Même principe pour les corrections manuelles d'objet homonyme (voir ItemPickerService) — les
    // méthodes `applyXReassign` ci-dessous sont, elles aussi, des no-op silencieux si la cible
    // (combat/achat/échange) n'existe plus dans cet historique reconstruit.
    for (const entry of this.itemReassignmentHistory) {
      switch (entry.kind) {
        case 'loot':
          this.applyLootReassign(
            entry.fightKey,
            entry.itemName,
            entry.sourceCatalogId,
            entry.quantity,
            entry.catalogId,
          );
          break;
        case 'purchase':
          this.applyPurchaseReassign(
            entry.purchaseKey,
            entry.quantity,
            entry.catalogId,
            entry.kamas,
          );
          break;
        case 'tradeItem':
          this.applyTradeItemReassign(
            entry.tradeKey,
            entry.direction,
            entry.itemName,
            entry.sourceCatalogId,
            entry.quantity,
            entry.catalogId,
          );
          break;
      }
    }
  }

  /**
   * Corrige manuellement l'objet retenu pour une ligne de butin (homonymes de rareté différente,
   * ex. "Larme d'Ogrest" — voir ItemPickerService). `fight` n'a besoin que des champs qui composent
   * `fightDedupKey` (voir history-dedup.util.ts) : fonctionne aussi bien sur un combat de la session
   * en cours que reconstruit depuis l'archive du compte (voir HistoryArchiveService, qui appelle sa
   * propre méthode miroir pour patcher ses lignes déjà chargées). `sourceCatalogId` : `catalogId`
   * ACTUEL de la ligne visée (voir PersistedItemReassignment, `LootRow.catalogId` — cible la ligne
   * directement par son id plutôt que par un rang positionnel, voir sa doc). `quantity` peut être
   * inférieure à celle de la ligne visée : elle est alors scindée (ou fusionnée dans une ligne
   * existante de même rareté) plutôt que réattribuée en bloc — voir reassignRowQuantity.
   */
  reassignLootItem(
    fight: Pick<FightRecord, 'time' | 'result' | 'rows'>,
    itemName: string,
    sourceCatalogId: number | null,
    quantity: number,
    catalogId: number,
  ): void {
    const fightKey = fightDedupKey(fight);
    this.applyLootReassign(fightKey, itemName, sourceCatalogId, quantity, catalogId);

    this.itemReassignmentHistory.push({
      kind: 'loot',
      fightKey,
      itemName,
      sourceCatalogId,
      quantity,
      catalogId,
    });
    this.trimItemReassignmentHistory();
    this.userData.write('itemReassignments', this.itemReassignmentHistory);
  }

  /** Miroir de reassignLootItem, pour un achat — voir sa doc. Un achat n'a pas d'"occurrence" (déjà
   * identifié sans ambiguïté par sa propre clé de dédoublonnage) ; une correction partielle crée un
   * second achat distinct plutôt que de scinder une ligne dans un tableau — voir
   * applyPurchaseReassign. `kamasOverride` : part du coût total choisie manuellement par
   * l'utilisateur (voir PersistedItemReassignment.kamas), `undefined` pour laisser
   * applyPurchaseReassign prorater automatiquement. */
  reassignPurchaseItem(
    purchase: Pick<PurchaseRecord, 'time' | 'item' | 'quantity' | 'totalCost'>,
    quantity: number,
    catalogId: number,
    kamasOverride?: number,
  ): void {
    const purchaseKey = purchaseDedupKey(purchase);
    this.applyPurchaseReassign(purchaseKey, quantity, catalogId, kamasOverride);

    this.itemReassignmentHistory.push({
      kind: 'purchase',
      purchaseKey,
      quantity,
      catalogId,
      kamas: kamasOverride,
    });
    this.trimItemReassignmentHistory();
    this.userData.write('itemReassignments', this.itemReassignmentHistory);
  }

  /** Miroir de reassignLootItem, pour une ligne d'objet échangé — voir sa doc. `sourceCatalogId` :
   * `catalogId` actuel de la ligne visée (voir PersistedItemReassignment, `trade_items` autorise
   * plusieurs lignes homonymes non fusionnées). */
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
    this.applyTradeItemReassign(
      tradeKey,
      direction,
      itemName,
      sourceCatalogId,
      quantity,
      catalogId,
    );

    this.itemReassignmentHistory.push({
      kind: 'tradeItem',
      tradeKey,
      direction,
      itemName,
      sourceCatalogId,
      quantity,
      catalogId,
    });
    this.trimItemReassignmentHistory();
    this.userData.write('itemReassignments', this.itemReassignmentHistory);
  }

  /** Consulté par HistoryArchiveService pour appliquer une correction déjà connue à une ligne de
   * butin qui vient d'être chargée depuis l'archive (pas encore présente en mémoire au moment de la
   * correction d'origine) — lecture pure, ne mute rien ici. La DERNIÈRE entrée correspondante gagne
   * (une correction plus récente sur la même ligne remplace la précédente). `rowQuantity` est la
   * quantité de la ligne TELLE QUE RENVOYÉE PAR LE SERVEUR à cet instant : si la correction trouvée
   * ne couvrait qu'une PARTIE de cette quantité, elle est ignorée ici plutôt qu'appliquée à tort à
   * la totalité — cas rare (fenêtre entre la correction locale et la fin de son renvoi serveur, voir
   * `applyLootReassign`), qui se résorbe de lui-même au prochain chargement une fois le renvoi
   * abouti (le serveur renverra alors directement les lignes déjà scindées). `null` si aucune
   * correction ne s'applique intégralement : l'appelant garde alors l'`itemId` renvoyé par le
   * serveur tel quel. */
  findLootCorrection(
    fightKey: string,
    itemName: string,
    sourceCatalogId: number | null,
    rowQuantity: number,
  ): number | null {
    const match = [...this.itemReassignmentHistory]
      .reverse()
      .find(
        (e): e is Extract<PersistedItemReassignment, { kind: 'loot' }> =>
          e.kind === 'loot' &&
          e.fightKey === fightKey &&
          e.sourceCatalogId === sourceCatalogId &&
          e.itemName.toLowerCase() === itemName.toLowerCase(),
      );
    return match && match.quantity >= rowQuantity ? match.catalogId : null;
  }

  /** Miroir de findLootCorrection, pour un achat — voir sa doc pour `rowQuantity`. */
  findPurchaseCorrection(purchaseKey: string, rowQuantity: number): number | null {
    const match = [...this.itemReassignmentHistory]
      .reverse()
      .find(
        (e): e is Extract<PersistedItemReassignment, { kind: 'purchase' }> =>
          e.kind === 'purchase' && e.purchaseKey === purchaseKey,
      );
    return match && match.quantity >= rowQuantity ? match.catalogId : null;
  }

  /** Miroir de findLootCorrection, pour une ligne d'objet échangé (voir reassignTradeItem pour
   * `sourceCatalogId`, et findLootCorrection pour `rowQuantity`). */
  findTradeItemCorrection(
    tradeKey: string,
    direction: 'acquired' | 'given',
    itemName: string,
    sourceCatalogId: number | null,
    rowQuantity: number,
  ): number | null {
    const match = [...this.itemReassignmentHistory]
      .reverse()
      .find(
        (e): e is Extract<PersistedItemReassignment, { kind: 'tradeItem' }> =>
          e.kind === 'tradeItem' &&
          e.tradeKey === tradeKey &&
          e.direction === direction &&
          e.itemName.toLowerCase() === itemName.toLowerCase() &&
          e.sourceCatalogId === sourceCatalogId,
      );
    return match && match.quantity >= rowQuantity ? match.catalogId : null;
  }

  private trimItemReassignmentHistory(): void {
    if (this.itemReassignmentHistory.length > MAX_ITEM_REASSIGNMENT_HISTORY) {
      this.itemReassignmentHistory.splice(
        0,
        this.itemReassignmentHistory.length - MAX_ITEM_REASSIGNMENT_HISTORY,
      );
    }
  }

  /** Ligne de `list` dont le nom correspond (insensible à la casse) ET dont le `catalogId` actuel
   * est `sourceCatalogId` — voir PersistedItemReassignment.sourceCatalogId. Unique par construction
   * (voir reassignRowQuantity : jamais deux lignes de même nom ET même `catalogId` dans une même
   * liste), contrairement à un rang positionnel qui dépendait implicitement de l'ordre du tableau. */
  private findRowByCatalogId<T extends { name: string; catalogId: number | null }>(
    list: readonly T[],
    name: string,
    sourceCatalogId: number | null,
  ): T | undefined {
    const key = name.toLowerCase();
    return list.find(
      (item) => item.name.toLowerCase() === key && item.catalogId === sourceCatalogId,
    );
  }

  /**
   * Réattribue tout ou partie de la quantité de `row` (déjà trouvée dans `list`, voir
   * `findRowByCatalogId`) vers `catalogId`. Fusionne dans une ligne EXISTANTE du même nom qui porte
   * déjà ce `catalogId` quand il y en a une (`target.quantity += amount`) — jamais deux lignes de
   * même rareté après une correction, bug réel corrigé : re-corriger une ligne déjà scindée vers une
   * rareté qui existait déjà ailleurs dans `list` créait une 3ᵉ ligne au lieu de se cumuler dans la
   * ligne cible. Sans ligne existante pour ce `catalogId`, en ajoute une nouvelle en FIN de `list`.
   * `row` elle-même est retirée de `list` si sa quantité restante tombe à 0 (jamais de ligne à
   * quantité nulle affichée). No-op si `catalogId` est déjà celui de `row` (rien à corriger).
   */
  private reassignRowQuantity<
    T extends { name: string; catalogId: number | null; quantity: number },
  >(list: T[], row: T, quantity: number, catalogId: number): void {
    if (catalogId === row.catalogId) return;
    const amount = Math.min(Math.max(1, Math.floor(quantity)), row.quantity);
    const key = row.name.toLowerCase();
    const target = list.find(
      (r) => r !== row && r.catalogId === catalogId && r.name.toLowerCase() === key,
    );
    row.quantity -= amount;
    if (target) target.quantity += amount;
    else list.push({ ...row, catalogId, quantity: amount });
    if (row.quantity <= 0) {
      const index = list.indexOf(row);
      if (index !== -1) list.splice(index, 1);
    }
  }

  private applyLootReassign(
    fightKey: string,
    itemName: string,
    sourceCatalogId: number | null,
    quantity: number,
    catalogId: number,
  ): void {
    const record = this.fightHistoryList.find((f) => fightDedupKey(f) === fightKey);
    if (!record) return;
    const row = this.findRowByCatalogId(record.loot, itemName, sourceCatalogId);
    if (!row) return;
    const wasFull = quantity >= row.quantity;
    this.reassignRowQuantity(record.loot, row, quantity, catalogId);

    // Compteur cumulé de session (toutes fusions confondues, voir sessionLootMap) : mis à jour
    // seulement pour une correction COMPLÈTE de la ligne — un compteur cumulé unique ne peut pas
    // représenter une scission partielle proprement, voir doc de sessionLoot.
    if (wasFull) {
      const sessionRow = this.sessionLootMap.get(itemName.toLowerCase());
      if (sessionRow) sessionRow.catalogId = catalogId;
      this.sessionLoot.set([...this.sessionLootMap.values()]);
    }

    this.fightHistory.set([...this.fightHistoryList]);
    // Combat déjà clôturé, donc déjà envoyé (ou en file) : le remettre en file avec son butin
    // corrigé — même clé déterministe (fightSignature n'inclut pas le butin), aucun doublon créé,
    // seule(s) la/les ligne(s) `fight_loot` visée(s) sont mises à jour côté serveur
    // (ON CONFLICT DO UPDATE) — la ligne scindée éventuelle part avec le même envoi (tout le combat
    // est renvoyé d'un bloc).
    this.historySync.recordFight(record);
  }

  private applyPurchaseReassign(
    purchaseKey: string,
    quantity: number,
    catalogId: number,
    kamasOverride?: number,
  ): void {
    const record = this.purchaseHistoryList.find((p) => purchaseDedupKey(p) === purchaseKey);
    if (!record) return;
    const amount = Math.min(Math.max(1, Math.floor(quantity)), record.quantity);

    if (amount >= record.quantity) {
      record.catalogId = catalogId;
      this.purchaseHistory.set([...this.purchaseHistoryList]);
      this.historySync.recordPurchase(record);
      return;
    }

    // Un achat n'est pas un tableau de lignes homonymes (contrairement au butin/aux échanges) :
    // une correction partielle crée un SECOND achat distinct plutôt que de scinder une entrée dans
    // un tableau. Coût réparti au prorata (arrondi) par défaut — sauf `kamasOverride` explicite
    // (voir ItemPickerRequest.totalKamas) : un achat n'est pas forcément linéaire en coût (remise
    // de gros, prix ayant varié entre deux achats agrégés le même jour), l'utilisateur peut donc
    // ajuster ce montant à la main plutôt que de subir le prorata automatique. Signature
    // naturellement distincte de toute façon (quantity/totalCost changent des deux côtés), donc
    // aucun risque de collision de clientKey avec l'achat d'origine.
    const unitCost = record.totalCost / record.quantity;
    const splitCost =
      kamasOverride !== undefined
        ? Math.min(Math.max(0, Math.round(kamasOverride)), record.totalCost)
        : Math.round(unitCost * amount);
    record.quantity -= amount;
    record.totalCost -= splitCost;
    const split: PurchaseRecord = {
      id: this.nextPurchaseId++,
      item: record.item,
      catalogId,
      quantity: amount,
      totalCost: splitCost,
      time: record.time,
      fullTimestampMs: record.fullTimestampMs,
    };
    this.purchaseHistoryList.push(split);

    this.purchaseHistory.set([...this.purchaseHistoryList]);
    this.historySync.recordPurchase(record);
    this.historySync.recordPurchase(split);
  }

  private applyTradeItemReassign(
    tradeKey: string,
    direction: 'acquired' | 'given',
    itemName: string,
    sourceCatalogId: number | null,
    quantity: number,
    catalogId: number,
  ): void {
    const record = this.tradeHistoryList.find((t) => tradeDedupKey(t) === tradeKey);
    if (!record) return;
    const row = this.findRowByCatalogId(record[direction], itemName, sourceCatalogId);
    if (!row) return;
    this.reassignRowQuantity(record[direction], row, quantity, catalogId);
    this.tradeHistory.set([...this.tradeHistoryList]);
    this.historySync.recordTrade(record);
  }

  /** Reconstruit la clé attackerMap ("Nom" ou "Nom#i", voir InitiativeSeat) d'une instance à partir de son nom/index affiché. */
  private instanceKey(working: FightWorking, name: string, instanceIndex: number): string {
    const instanceCount = this.countNameInstances(working, name.toLowerCase()) || 1;
    return instanceCount <= 1 ? name : `${name}#${instanceIndex}`;
  }

  private reassignLiveSpell(
    working: FightWorking,
    spellName: string,
    from: { name: string; instanceIndex: number },
    to: { name: string; instanceIndex: number },
  ): void {
    const fromKey = this.instanceKey(working, from.name, from.instanceIndex);
    const fromSpells = working.attackerMap.get(fromKey);
    const agg = fromSpells?.get(spellName);
    if (!fromSpells || !agg) return;
    fromSpells.delete(spellName);

    const toKey = this.instanceKey(working, to.name, to.instanceIndex);
    let toSpells = working.attackerMap.get(toKey);
    if (!toSpells) {
      toSpells = new Map();
      working.attackerMap.set(toKey, toSpells);
    }
    const existing = toSpells.get(spellName);
    if (existing) {
      existing.total += agg.total;
      for (const [element, amount] of agg.byElement) {
        existing.byElement.set(element, (existing.byElement.get(element) ?? 0) + amount);
      }
      for (const [turn, turnAgg] of agg.byTurn) {
        let existingTurn = existing.byTurn.get(turn);
        if (!existingTurn) {
          existingTurn = { total: 0, byElement: new Map() };
          existing.byTurn.set(turn, existingTurn);
        }
        existingTurn.total += turnAgg.total;
        for (const [element, amount] of turnAgg.byElement) {
          existingTurn.byElement.set(element, (existingTurn.byElement.get(element) ?? 0) + amount);
        }
      }
    } else {
      toSpells.set(spellName, agg);
    }
    this.publish();
  }

  private reassignHistoricalSpell(
    fightId: number,
    spellName: string,
    from: { name: string; instanceIndex: number },
    to: { name: string; instanceIndex: number },
  ): void {
    const record = this.fightHistoryList.find((f) => f.id === fightId);
    if (!record) return;

    const fromRow = record.rows.find(
      (r) => r.name === from.name && r.instanceIndex === from.instanceIndex,
    );
    const spellIdx = fromRow?.spells.findIndex((s) => s.spell === spellName) ?? -1;
    if (!fromRow || spellIdx === -1) return;
    const [moved] = fromRow.spells.splice(spellIdx, 1);
    fromRow.total = fromRow.spells.reduce((sum, s) => sum + s.total, 0);

    const toRow = record.rows.find(
      (r) => r.name === to.name && r.instanceIndex === to.instanceIndex,
    );
    if (!toRow) return;
    const existing = toRow.spells.find((s) => s.spell === spellName);
    if (existing) {
      existing.total += moved.total;
      for (const [element, amount] of Object.entries(moved.byElement)) {
        existing.byElement[element as DamageElement] =
          (existing.byElement[element as DamageElement] ?? 0) + amount;
      }
      for (const movedTurn of moved.byTurn) {
        const existingTurn = existing.byTurn.find((t) => t.turn === movedTurn.turn);
        if (existingTurn) {
          existingTurn.total += movedTurn.total;
          for (const [element, amount] of Object.entries(movedTurn.byElement)) {
            existingTurn.byElement[element as DamageElement] =
              (existingTurn.byElement[element as DamageElement] ?? 0) + amount;
          }
        } else {
          existing.byTurn.push(movedTurn);
        }
      }
      existing.byTurn.sort((a, b) => a.turn - b.turn);
    } else {
      toRow.spells.push(moved);
    }
    toRow.spells.sort((a, b) => b.total - a.total);
    toRow.total = toRow.spells.reduce((sum, s) => sum + s.total, 0);

    record.rows.sort((a, b) => b.total - a.total);
    this.fightHistory.set([...this.fightHistoryList]);
  }
}
