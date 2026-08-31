import { Injectable, computed, inject, signal } from '@angular/core';
import { ChatPanelService } from './chat-panel.service';
import { UserDataService } from '../data-access/user-data.service';

export type DashboardMenuPos = 'left' | 'right' | 'top-left' | 'top-right';
export type DashboardKpiPos = 'top' | 'bottom' | 'left' | 'right';
export type DashboardBodyMode = 'equal' | 'focus';
/** Côté où se rangent les cartes secondaires en mode "mise en avant" — la carte ciblée occupe
 * l'AUTRE côté, en pleine hauteur (voir `gridPlan`). */
export type DashboardFocusSide = 'left' | 'right';
export type DashboardHistoryKey = 'combats' | 'purchases' | 'trades';
/** Les 5 blocs "logiques" du corps, indépendamment du regroupement de l'historique (voir
 * `historyGroup`) — sert de référentiel stable pour `blockOrder` : contrairement à
 * `DashboardBodySlotKey`, dont `hist_group` apparaît/disparaît selon le regroupement, ces 5 clés
 * existent toujours, ce qui permet de retrouver le rang voulu même quand la carte groupée n'est pas
 * (ou plus) affichée (voir `activeSlots`). `'recap'` (carte Récap de session, voir
 * SessionRecapComponent) n'a, comme `'chat'`, aucun rapport avec le regroupement de l'historique. */
export type DashboardBlockKey = DashboardHistoryKey | 'chat' | 'recap';

/** Identifiant d'une "carte" potentielle du corps — `'hist_group'` désigne le bloc Historique
 * regroupé (voir `visibleBodySlots`), son identité change de contenu mais pas de clé selon
 * `historyGroup`. Pas de clé `'combat'` : le combat en cours n'est plus une carte à part (voir
 * CLAUDE.md) — il vit désormais DANS `'hist_combats'`/`'hist_group'` (voir
 * `FightHistoryComponent`), ni ciblable en mise en avant ni repliable indépendamment. `'recap'`
 * (Récap de session) est indépendante de l'historique — jamais regroupable avec lui. */
export type DashboardBodySlotKey =
  'hist_combats' | 'hist_purchases' | 'hist_trades' | 'hist_group' | 'chat' | 'recap';

/** Section repliable individuellement — le menu et les objectifs en plus des cartes du corps (voir
 * `DashboardBodySlotKey`), car eux aussi peuvent se réduire (bande d'icônes) même si leur repli ne
 * libère pas la même quantité d'espace (voir `DashboardComponent`/`DashboardLayoutPickerComponent`). */
export type DashboardCollapsibleKey = 'menu' | 'kpi' | DashboardBodySlotKey;

/** Toute case de la grille du corps, y compris Suivi — TOUJOURS visible et jamais ciblable comme
 * mise en avant (absent de `DashboardBodySlotKey`), voir doc de tête de `gridPlan`. */
export type DashboardGridKey = 'tracker' | DashboardBodySlotKey;

export interface DashboardBodySlot {
  readonly key: DashboardBodySlotKey;
  /** Couleur de vignette (voir DashboardLayoutSchemaComponent) — une par volet d'historique SOLO
   * (`DashboardHistoryKey`, sa propre teinte) plutôt qu'une seule couleur "historique" partagée :
   * ne prend la valeur générique `'history'` que pour la carte `hist_group` (regroupement d'au
   * moins 2 volets, voir `activeSlots`), qui a sa propre couleur "méta" distincte des 3 volets
   * individuels (voir CLAUDE.md). */
  readonly sw: DashboardHistoryKey | 'history' | 'chat' | 'recap';
}

/** Placement calculé d'une case dans `.panels-row` (grille CSS, voir `dashboard.component.css`) —
 * `gridColumn`/`gridRow` posés tels quels en style inline (`1 / -1`, `2`, `1 / 3`...), `order` pour
 * les cas où l'ordre visuel suffit (répartition égale, grid-auto-flow). Toujours des valeurs
 * explicites (jamais de classe CSS externe) : un panneau scindé d'`<app-history>` (`display:contents`)
 * porte l'attribut d'encapsulation de vue de CE composant, pas celui de `DashboardComponent` — une
 * classe posée depuis un stylesheet scopé à `DashboardComponent` ne l'atteindrait jamais (bug réel
 * rencontré avec `.grid-span2`, voir historique de session), alors qu'un style inline n'a pas ce
 * problème. */
export interface DashboardGridSlot {
  readonly key: DashboardGridKey;
  readonly visible: boolean;
  readonly gridColumn: string;
  readonly gridRow: string;
  readonly order: number;
}

export interface DashboardLayoutPrefs {
  readonly menuPos: DashboardMenuPos;
  readonly kpiPos: DashboardKpiPos;
  readonly bodyMode: DashboardBodyMode;
  readonly focusTarget: DashboardBodySlotKey;
  readonly focusSide: DashboardFocusSide;
  /** Volets qu'un utilisateur souhaite voir REGROUPÉS dans un seul bloc Historique (voir
   * `activeSlots`) — INVERSE de l'ancien `historySplit` (où `true` scindait un volet dans sa propre
   * carte) : par défaut (tout `false`), Combats/Achats/Échanges sont chacun leur propre carte, et
   * il faut en cocher AU MOINS DEUX pour qu'un regroupement ait lieu (voir `activeSlots` — un seul
   * volet coché équivaudrait à ne rien regrouper). Renommé (pas juste réinterprété) lors de
   * l'inversion de ce réglage (voir CLAUDE.md) : un ancien `historySplit` déjà persisté chez un
   * utilisateur ne doit surtout pas se relire sous la nouvelle clé avec un sens inversé — `applyStored`
   * ignore simplement l'ancien champ (absent sous ce nouveau nom), l'utilisateur repart sur le
   * nouveau défaut plutôt que de voir sa disposition basculer à l'envers sans prévenir. */
  readonly historyGroup: Readonly<Record<DashboardHistoryKey, boolean>>;
  /** Ordre d'affichage voulu des 4 blocs logiques (voir `DashboardBlockKey`) — une permutation de
   * `ALL_BLOCK_KEYS`. Pilote l'ordre des cartes du corps aussi bien en répartition égale qu'en mise
   * en avant (l'ordre des cartes secondaires empilées suit ce même classement, voir `activeSlots`). */
  readonly blockOrder: readonly DashboardBlockKey[];
  readonly collapsedSections: Readonly<Partial<Record<DashboardCollapsibleKey, boolean>>>;
}

const DEFAULT_PREFS: DashboardLayoutPrefs = {
  menuPos: 'left',
  kpiPos: 'top',
  bodyMode: 'focus',
  // 'combat' n'existe plus comme carte cible (voir DashboardBodySlotKey) — 'hist_group' n'est plus
  // systématiquement présente (voir historyGroup ci-dessous, désormais l'exception plutôt que le
  // défaut) : 'hist_combats' est un repli plus sûr, toujours l'un des 3 volets solo par défaut.
  focusTarget: 'hist_combats',
  focusSide: 'right',
  // Achats + Échanges regroupés par défaut dans une seule carte Historique ; Combats reste solo,
  // mis en avant (voir bodyMode/focusTarget ci-dessus).
  historyGroup: { combats: false, purchases: true, trades: true },
  blockOrder: ['combats', 'chat', 'purchases', 'trades', 'recap'],
  // Récap de session repliée par défaut (rejoint le rail latéral) : contrairement aux 4 autres
  // cartes, son ancien équivalent (bouton modal du header) était lui aussi entièrement opt-in —
  // l'ajouter ici visible d'emblée changerait la mise en page de tous les utilisateurs existants
  // dès ce déploiement, sans qu'ils l'aient demandé (voir CLAUDE.md/décision produit).
  collapsedSections: { recap: true },
};

const HIST_KEYS: readonly DashboardHistoryKey[] = ['combats', 'purchases', 'trades'];
const ALL_BLOCK_KEYS: readonly DashboardBlockKey[] = [
  'combats',
  'purchases',
  'trades',
  'chat',
  'recap',
];

/** Un `blockOrder` stocké n'est utilisable que s'il contient exactement une permutation des 4 clés
 * connues — un ancien format, une clé disparue/renommée, ou une valeur corrompue en localStorage
 * ferait planter `indexOf`/le tri sinon silencieusement (rang `-1` mal géré) : on retombe alors
 * entièrement sur `DEFAULT_PREFS.blockOrder` plutôt que de tenter une réparation partielle. */
function isValidBlockOrder(value: unknown): value is DashboardBlockKey[] {
  return (
    Array.isArray(value) &&
    value.length === ALL_BLOCK_KEYS.length &&
    ALL_BLOCK_KEYS.every((k) => value.includes(k))
  );
}

/** Un `blockOrder` stocké AVANT l'introduction de la carte Récap (voir CLAUDE.md) contient une
 * permutation exacte des 4 anciennes clés, sans `'recap'` — `isValidBlockOrder` le rejetterait tel
 * quel (mauvaise longueur), ce qui ferait retomber tout utilisateur ayant déjà personnalisé son
 * ordre sur `DEFAULT_PREFS.blockOrder` en entier au premier chargement après ce changement. Migré
 * ici en ajoutant `'recap'` en fin plutôt que jeté, pour préserver l'ordre déjà choisi pour les 4
 * blocs historiques. */
const LEGACY_BLOCK_KEYS: readonly DashboardBlockKey[] = ['combats', 'purchases', 'trades', 'chat'];
function migrateLegacyBlockOrder(value: unknown): DashboardBlockKey[] | null {
  if (
    Array.isArray(value) &&
    value.length === LEGACY_BLOCK_KEYS.length &&
    LEGACY_BLOCK_KEYS.every((k) => value.includes(k))
  ) {
    return [...(value as DashboardBlockKey[]), 'recap'];
  }
  return null;
}
const ALL_GRID_KEYS: readonly DashboardGridKey[] = [
  'tracker',
  'hist_combats',
  'hist_purchases',
  'hist_trades',
  'hist_group',
  'chat',
  'recap',
];

/**
 * Préférence de disposition du tableau de bord (Profil › Personnalisation) — synchronisable avec le
 * compte (voir `UserDataService`/CLAUDE.md, clé `dashboardLayout`) : un utilisateur qui se reconnecte
 * sur un autre appareil/navigateur retrouve exactement la même disposition, comme les autres
 * préférences déjà synchronisées (`ChatPanelService`, même mécanique `onExternalChange`
 * ci-dessous).
 *
 * Porte l'état choisi par l'utilisateur (persisté, exposé en signaux) ET la dérivation partagée
 * (quelles cartes du corps sont visibles, quel mode s'applique réellement, comment se placent-elles
 * dans `.panels-row`) — consommée à la fois par `DashboardLayoutPickerComponent` (Profil ›
 * Personnalisation, avec ses propres libellés traduits) et par le VRAI tableau de bord
 * (`DashboardComponent`/`DashboardRailComponent`/`TrackerStripComponent`/`HistoryComponent`), pour
 * n'avoir qu'un seul calcul de la disposition. Pas de carte "Combat" ici (voir
 * `DashboardBodySlotKey`) — son contenu vit désormais DANS la carte Historique › Combats,
 * toujours repliable/scindable/ciblable comme les autres (voir CLAUDE.md).
 *
 * Chat a DÉJÀ sa propre notion de repli (`ChatPanelService`, synchronisée sur le compte, pilote
 * aussi `DashboardRailComponent`) — `isCollapsed`/`toggleCollapsed` délèguent donc à ce service
 * pour cette clé plutôt que de dupliquer un second état déconnecté du premier (qui
 * désynchroniserait le rail des icônes repliées et la grille du corps). Toutes les autres cartes du
 * corps (Historique groupé et chacune de ses scissions) sont repliables de la MÊME façon
 * (`.collapse-btn` sur leur panneau, voir `HistoryComponent`) et rejoignent elles aussi
 * `DashboardRailComponent`, généralisé pour lister dynamiquement toute carte repliée plutôt que
 * seulement Chat.
 */
@Injectable({ providedIn: 'root' })
export class DashboardLayoutService {
  private readonly userData = inject(UserDataService);
  private readonly chatPanel = inject(ChatPanelService);

  readonly menuPos = signal<DashboardMenuPos>(DEFAULT_PREFS.menuPos);
  readonly kpiPos = signal<DashboardKpiPos>(DEFAULT_PREFS.kpiPos);
  readonly bodyMode = signal<DashboardBodyMode>(DEFAULT_PREFS.bodyMode);
  readonly focusTarget = signal<DashboardBodySlotKey>(DEFAULT_PREFS.focusTarget);
  readonly focusSide = signal<DashboardFocusSide>(DEFAULT_PREFS.focusSide);
  readonly historyGroup = signal<Record<DashboardHistoryKey, boolean>>({
    ...DEFAULT_PREFS.historyGroup,
  });
  readonly blockOrder = signal<DashboardBlockKey[]>([...DEFAULT_PREFS.blockOrder]);
  /** Repli de Menu/Objectifs/Historique/Récap — PAS Chat, voir doc de tête (délégué). Valeur
   * initiale = `DEFAULT_PREFS.collapsedSections` (pas `{}`) : un nouvel utilisateur sans rien de
   * stocké (`applyStored` retourne alors avant de toucher ce signal, voir plus bas) doit quand même
   * démarrer avec Récap repliée par défaut, pas seulement un utilisateur ayant déjà persisté une
   * disposition. */
  readonly collapsedSections = signal<Partial<Record<DashboardCollapsibleKey, boolean>>>({
    ...DEFAULT_PREFS.collapsedSections,
  });

  constructor() {
    this.applyStored();

    // Un autre appareil a modifié la disposition (voir UserDataService/CLAUDE.md) : recharger les
    // signaux depuis le compte, sinon cet onglet resterait figé sur l'ancienne disposition jusqu'au
    // prochain rechargement de page. `applyStored()` ne fait que des `.set()` (jamais de
    // `userData.write()`, voir `persist()`) : pas de risque de réécrire aussitôt ce qu'on vient de
    // recevoir avec un horodatage local plus récent, qui le ferait repartir en boucle vers le
    // compte à la synchronisation suivante.
    this.userData.onExternalChange('dashboardLayout', () => this.applyStored());
  }

  private applyStored(): void {
    const stored = this.userData.read<Partial<DashboardLayoutPrefs>>('dashboardLayout');
    if (!stored) return;
    if (stored.menuPos) this.menuPos.set(stored.menuPos);
    if (stored.kpiPos) this.kpiPos.set(stored.kpiPos);
    if (stored.bodyMode) this.bodyMode.set(stored.bodyMode);
    if (stored.focusTarget) this.focusTarget.set(stored.focusTarget);
    if (stored.focusSide) this.focusSide.set(stored.focusSide);
    if (stored.historyGroup) {
      this.historyGroup.set({ ...DEFAULT_PREFS.historyGroup, ...stored.historyGroup });
    }
    if (isValidBlockOrder(stored.blockOrder)) {
      this.blockOrder.set([...stored.blockOrder]);
    } else {
      const migrated = migrateLegacyBlockOrder(stored.blockOrder);
      if (migrated) this.blockOrder.set(migrated);
    }
    // Fusionné sur le défaut (même principe que `historyGroup` ci-dessus), pas remplacé tel quel :
    // un utilisateur qui a persisté ce champ AVANT l'introduction d'une nouvelle clé repliable
    // (ex. 'recap') a un objet stocké qui ne la connaît pas encore — un remplacement pur la
    // ferait retomber à `undefined`/visible au lieu de son propre défaut (`DEFAULT_PREFS`,
    // 'recap' repliée), pour un utilisateur qui n'a pourtant rien choisi à ce sujet.
    if (stored.collapsedSections) {
      this.collapsedSections.set({
        ...DEFAULT_PREFS.collapsedSections,
        ...stored.collapsedSections,
      });
    }
  }

  /** Écrit l'état courant en un seul bloc JSON (plutôt qu'une clé par champ comme ThemeService) :
   * ces champs forment une seule préférence cohérente, jamais lus/écrits indépendamment les uns des
   * autres. Appelé explicitement par chaque mutateur ci-dessous plutôt que réactivement (`effect()`) :
   * un `effect()` réagirait aussi aux `.set()` de `applyStored()` (hydratation, `onExternalChange`)
   * et republierait aussitôt une valeur inchangée avec un nouvel horodatage local — voir son
   * commentaire. */
  private persist(): void {
    this.userData.write('dashboardLayout', {
      menuPos: this.menuPos(),
      kpiPos: this.kpiPos(),
      bodyMode: this.bodyMode(),
      focusTarget: this.focusTarget(),
      focusSide: this.focusSide(),
      historyGroup: this.historyGroup(),
      blockOrder: this.blockOrder(),
      collapsedSections: this.collapsedSections(),
    } satisfies DashboardLayoutPrefs);
  }

  setMenuPos(value: DashboardMenuPos): void {
    this.menuPos.set(value);
    this.persist();
  }
  setKpiPos(value: DashboardKpiPos): void {
    this.kpiPos.set(value);
    this.persist();
  }
  setBodyMode(value: DashboardBodyMode): void {
    this.bodyMode.set(value);
    this.persist();
  }
  setFocusTarget(value: DashboardBodySlotKey): void {
    this.focusTarget.set(value);
    this.persist();
  }
  setFocusSide(value: DashboardFocusSide): void {
    this.focusSide.set(value);
    this.persist();
  }
  toggleHistoryGroup(key: DashboardHistoryKey): void {
    this.historyGroup.update((cur) => ({ ...cur, [key]: !cur[key] }));
    this.persist();
  }
  /** Échange la position de 2 blocs logiques dans `blockOrder` — primitive de base pour toute
   * réorganisation, no-op si l'une des 2 clés est absente ou si elles sont identiques. */
  swapBlocks(a: DashboardBlockKey, b: DashboardBlockKey): void {
    this.blockOrder.update((cur) => {
      const i = cur.indexOf(a);
      const j = cur.indexOf(b);
      if (i === -1 || j === -1 || i === j) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    this.persist();
  }

  /** Membre de `blockOrder` qui détermine la position d'une CARTE du corps (voir
   * `DashboardBodySlotKey`) — la clé elle-même pour une carte solo, le membre de rang le plus
   * favorable (voir `activeSlots`) pour la carte Historique groupée : c'est ce même membre qui fixe
   * où `activeSlots` place la carte groupée, donc l'échanger avec un autre bloc déplace bien la
   * carte groupée dans son ensemble (les autres volets qu'elle regroupe gardent leur rang individuel
   * inchangé — invisible tant qu'ils restent regroupés, voir `activeSlots`). */
  private representativeBlockKey(key: DashboardBodySlotKey): DashboardBlockKey | null {
    if (key === 'chat') return 'chat';
    if (key === 'recap') return 'recap';
    if (key === 'hist_group') {
      const group = this.historyGroup();
      const grouped = HIST_KEYS.filter((k) => group[k]);
      if (grouped.length === 0) return null;
      const order = this.blockOrder();
      return grouped.reduce((best, k) => (order.indexOf(k) < order.indexOf(best) ? k : best));
    }
    return key.slice('hist_'.length) as DashboardBlockKey;
  }

  /** Échange la position de 2 cartes du corps (voir `DashboardBodySlotKey`, l'identité que connaît
   * réellement l'UI — `DashboardLayoutPickerComponent`, section "Ordre des blocs") — résout chaque
   * côté vers son `representativeBlockKey` puis délègue à `swapBlocks`, seule primitive qui touche
   * réellement `blockOrder`. */
  swapSlots(a: DashboardBodySlotKey, b: DashboardBodySlotKey): void {
    const ra = this.representativeBlockKey(a);
    const rb = this.representativeBlockKey(b);
    if (!ra || !rb || ra === rb) return;
    this.swapBlocks(ra, rb);
  }

  isCollapsed(key: DashboardCollapsibleKey): boolean {
    if (key === 'chat') return this.chatPanel.collapsed();
    return !!this.collapsedSections()[key];
  }
  toggleCollapsed(key: DashboardCollapsibleKey): void {
    if (key === 'chat') {
      this.chatPanel.setCollapsed(!this.chatPanel.collapsed());
      return;
    }
    this.collapsedSections.update((cur) => ({ ...cur, [key]: !cur[key] }));
    this.persist();
  }

  reset(): void {
    this.menuPos.set(DEFAULT_PREFS.menuPos);
    this.kpiPos.set(DEFAULT_PREFS.kpiPos);
    this.bodyMode.set(DEFAULT_PREFS.bodyMode);
    this.focusTarget.set(DEFAULT_PREFS.focusTarget);
    this.focusSide.set(DEFAULT_PREFS.focusSide);
    this.historyGroup.set({ ...DEFAULT_PREFS.historyGroup });
    this.blockOrder.set([...DEFAULT_PREFS.blockOrder]);
    this.collapsedSections.set({ ...DEFAULT_PREFS.collapsedSections });
    this.persist();
  }

  // --- Dérivation partagée (corps : Historique×N / Chat) -------------------------------------

  /** Volets d'historique affichés chacun dans leur propre carte — device-INDÉPENDANT (utilisé aussi
   * bien pour le placement de grille desktop que pour les onglets mobile, voir `DashboardComponent`/
   * `HistoryComponent` : avant l'introduction des onglets mobile dynamiques, `HistoryComponent`
   * ignorait ce réglage sous 800px et affichait systématiquement les 3 volets regroupés — CLAUDE.md).
   * Tous les 3 par défaut, sauf si l'utilisateur a coché AU MOINS DEUX volets à regrouper
   * (`historyGroup`) — un seul volet coché ne regrouperait rien, il reste alors solo. */
  readonly historySplitKeys = computed<DashboardHistoryKey[]>(() => {
    const group = this.historyGroup();
    const grouped = HIST_KEYS.filter((k) => group[k]);
    return grouped.length >= 2 ? HIST_KEYS.filter((k) => !group[k]) : [...HIST_KEYS];
  });
  /** Complément de `historySplitKeys` : volets regroupés dans la carte `hist_group` (vide quand le
   * regroupement n'est pas actif). */
  readonly historyGroupedKeys = computed<DashboardHistoryKey[]>(() => {
    const solo = new Set(this.historySplitKeys());
    return HIST_KEYS.filter((k) => !solo.has(k));
  });

  /** Cartes potentielles du corps, dans l'ordre — jamais plus de 3 liées à l'historique. Pas de
   * carte "Combat" à part : le combat en cours vit désormais DANS `hist_combats`/`hist_group`
   * (voir CLAUDE.md/FightHistoryComponent), toujours présentes ici qu'un combat soit en cours ou
   * non.
   *
   * Par défaut, Combats/Achats/Échanges sont chacun leur propre carte (`sw` = leur propre couleur) —
   * `hist_group` (couleur "méta" distincte) n'apparaît QUE si l'utilisateur a coché AU MOINS DEUX
   * volets à regrouper (`historyGroup`, voir CLAUDE.md) : un seul volet coché ne suffit pas (ça ne
   * regrouperait rien de plusieurs volets), il reste alors solo comme les autres — cf. la "tactique"
   * demandée pour ce cas. */
  readonly activeSlots = computed<DashboardBodySlot[]>(() => {
    const slots: DashboardBodySlot[] = [];
    const soloKeys = this.historySplitKeys();
    const groupedKeys = this.historyGroupedKeys();
    for (const k of soloKeys) {
      slots.push({ key: `hist_${k}` as DashboardBodySlotKey, sw: k });
    }
    if (groupedKeys.length > 0) slots.push({ key: 'hist_group', sw: 'history' });
    slots.push({ key: 'chat', sw: 'chat' });
    slots.push({ key: 'recap', sw: 'recap' });

    // Réordonne selon la préférence utilisateur (voir `blockOrder`/`DashboardBlockKey`) : une carte
    // solo prend le rang de sa propre clé logique, la carte groupée prend le rang le plus favorable
    // (le plus petit index) parmi les volets qu'elle regroupe — elle apparaît ainsi à la position du
    // premier de ses membres dans le classement, plutôt qu'à une position arbitraire fixe.
    const order = this.blockOrder();
    const rankOf = (k: DashboardBlockKey): number => {
      const i = order.indexOf(k);
      return i === -1 ? order.length : i;
    };
    const rankOfSlot = (s: DashboardBodySlot): number =>
      s.key === 'hist_group'
        ? Math.min(...groupedKeys.map(rankOf))
        : rankOf(s.sw as DashboardBlockKey);
    return slots.sort((a, b) => rankOfSlot(a) - rankOfSlot(b));
  });

  /** Toute carte du corps est désormais toujours potentiellement présente (plus de carte "Combat"
   * apparaissant/disparaissant selon `hasActiveFight`, voir doc de tête) — alias direct
   * d'`activeSlots`, conservé sous ce nom pour ne pas répercuter le changement sur ses appelants
   * (`DashboardLayoutPickerComponent`). */
  readonly chipSlots = this.activeSlots;

  /** Cartes réellement visibles : `activeSlots` moins celles repliées manuellement. */
  readonly visibleBodySlots = computed(() =>
    this.activeSlots().filter((s) => !this.isCollapsed(s.key)),
  );

  readonly effectiveBodyMode = computed<DashboardBodyMode>(() => {
    if (this.bodyMode() !== 'focus') return 'equal';
    return this.visibleBodySlots().some((s) => s.key === this.focusTarget()) ? 'focus' : 'equal';
  });

  /** Colonnes de `.panels-row` (`grid-template-columns`, posé en inline depuis DashboardComponent) —
   * 2 colonnes égales en répartition égale ; en mise en avant, une colonne étroite (les secondaires,
   * empilées) et une large (la cible, ~2x plus large — mêmes proportions que la maquette validée
   * avec l'utilisateur), du côté choisi (`focusSide`). Une seule colonne quand la cible est SEULE
   * visible (toutes les secondaires repliées) : sans ce cas particulier, la cible resterait confinée
   * à sa colonne large habituelle avec un vide béant à côté — plus aucune raison de réserver une
   * colonne à des secondaires qui n'existent plus (bug réel remonté par l'utilisateur). */
  readonly panelsColumns = computed<string>(() => {
    if (this.effectiveBodyMode() !== 'focus') return 'repeat(2, minmax(0, 1fr))';
    if (this.visibleBodySlots().length <= 1) return 'minmax(0, 1fr)';
    const narrow = 'minmax(260px, 1fr)';
    const wide = 'minmax(0, 2fr)';
    return this.focusSide() === 'left' ? `${narrow} ${wide}` : `${wide} ${narrow}`;
  });

  /** Placement calculé de CHAQUE case possible de `.panels-row` (voir `DashboardGridSlot`) — Suivi
   * n'y participe PAS : `TrackerComponent` est `display:none` en desktop, quel que soit ce plan
   * (remplacé par `TrackerStripComponent`, voir CLAUDE.md/dashboard.component.html) — l'inclure
   * dans le compte fausserait `panelsRowCount` (une case "invisible" y consommerait quand même une
   * ligne). Sa clé reste dans `DashboardGridKey`/`ALL_GRID_KEYS` (toujours `{visible:false}` par
   * défaut ci-dessous) uniquement pour que le template puisse lui appliquer les mêmes bindings sans
   * cas particulier, sans effet puisqu'il ne se rend jamais en desktop.
   *
   * Répartition égale : grille à 2 colonnes max (`grid-auto-flow` gère le placement via `order`
   * seul), le dernier élément d'un total impair prend toute la largeur de sa ligne (`gridColumn:
   * '1 / -1'`).
   *
   * Mise en avant : la cible occupe TOUTE sa colonne (`gridRow: '1 / -1'`, pleine hauteur) du côté
   * opposé à `focusSide` (voir `panelsColumns`) ; chaque secondaire occupe sa propre ligne dans
   * l'AUTRE colonne (`gridRow` explicite, une case par ligne — jamais de partage de ligne entre
   * secondaires, contrairement à la répartition égale) — reproduit le "bloc central massif + bande
   * latérale empilée" de la maquette validée, plutôt que l'ancienne approximation (cible en pleine
   * largeur en tête, secondaires en grille 2 colonnes en dessous) qui ne correspondait pas à ce qui
   * avait été présenté à l'utilisateur. */
  readonly gridPlan = computed<Record<DashboardGridKey, DashboardGridSlot>>(() => {
    const plan = {} as Record<DashboardGridKey, DashboardGridSlot>;
    for (const key of ALL_GRID_KEYS) {
      plan[key] = { key, visible: false, gridColumn: 'auto', gridRow: 'auto', order: 0 };
    }

    const items: DashboardGridKey[] = this.visibleBodySlots().map((s) => s.key);
    if (this.effectiveBodyMode() === 'focus') {
      const target = this.focusTarget();
      const secondaries = items.filter((k) => k !== target);
      if (secondaries.length === 0) {
        // Cible seule visible (toutes les secondaires repliées, voir `panelsColumns` — grille
        // ramenée à une seule colonne dans ce cas) : pleine largeur plutôt que confinée à sa
        // colonne habituelle.
        plan[target] = { key: target, visible: true, gridColumn: '1 / -1', gridRow: '1', order: 0 };
      } else {
        const mainCol = this.focusSide() === 'left' ? '2' : '1';
        const secCol = this.focusSide() === 'left' ? '1' : '2';
        plan[target] = {
          key: target,
          visible: true,
          gridColumn: mainCol,
          gridRow: '1 / -1',
          order: 0,
        };
        secondaries.forEach((key, i) => {
          plan[key] = {
            key,
            visible: true,
            gridColumn: secCol,
            gridRow: String(i + 1),
            order: i + 1,
          };
        });
      }
    } else {
      const n = items.length;
      items.forEach((key, i) => {
        const span2 = n % 2 === 1 && i === n - 1;
        plan[key] = {
          key,
          visible: true,
          gridColumn: span2 ? '1 / -1' : 'auto',
          gridRow: 'auto',
          order: i,
        };
      });
    }
    return plan;
  });

  /** Nombre de lignes à donner à `.panels-row` (`grid-template-rows`, voir DashboardComponent) —
   * toujours 2 colonnes max, donc `ceil(n / 2)` lignes pour `n` cases visibles en répartition égale
   * (Suivi exclu, voir `gridPlan`). En mise en avant, une ligne par secondaire (la cible span sur
   * TOUTES les lignes via `gridRow: '1 / -1'`, elle n'en impose donc aucune de plus). Au moins 1
   * (une grille à 0 ligne n'a pas de sens même si `n` vaut 0, ou en mise en avant sans secondaire). */
  readonly panelsRowCount = computed(() => {
    const n = this.visibleBodySlots().length;
    if (n === 0) return 1;
    if (this.effectiveBodyMode() === 'focus') return Math.max(1, n - 1);
    return Math.max(1, Math.ceil(n / 2));
  });
}
