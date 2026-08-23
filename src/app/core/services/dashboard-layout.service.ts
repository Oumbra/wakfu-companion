import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';
import { CombatPanelService } from './combat-panel.service';
import { ChatPanelService } from './chat-panel.service';

export type DashboardMenuPos = 'left' | 'right' | 'top-left' | 'top-right';
export type DashboardKpiPos = 'top' | 'bottom' | 'left' | 'right';
export type DashboardBodyMode = 'equal' | 'focus';
export type DashboardHistoryKey = 'combats' | 'purchases' | 'trades';

/** Identifiant d'une "carte" potentielle du corps — `'hist_group'` désigne le bloc Historique
 * restant après découpage (voir `visibleBodySlots`), son identité change de contenu mais pas de
 * clé selon `historySplit`. */
export type DashboardBodySlotKey =
  'combat' | 'hist_combats' | 'hist_purchases' | 'hist_trades' | 'hist_group' | 'chat';

/** Section repliable individuellement — le menu et les objectifs en plus des cartes du corps (voir
 * `DashboardBodySlotKey`), car eux aussi peuvent se réduire (bande d'icônes) même si leur repli ne
 * libère pas la même quantité d'espace (voir `DashboardComponent`/`DashboardLayoutPickerComponent`). */
export type DashboardCollapsibleKey = 'menu' | 'kpi' | DashboardBodySlotKey;

/** Toute case de la grille du corps, y compris Suivi — TOUJOURS visible et jamais ciblable comme
 * mise en avant (absent de `DashboardBodySlotKey`), voir doc de tête de `gridPlan`. */
export type DashboardGridKey = 'tracker' | DashboardBodySlotKey;

export interface DashboardBodySlot {
  readonly key: DashboardBodySlotKey;
  readonly sw: 'combat' | 'history' | 'chat';
}

/** Placement calculé d'une case dans `.panels-row` (grille CSS à 2 colonnes max, voir
 * `dashboard.component.css`) — `span2` = pleine largeur (dernier élément d'un total impair en
 * répartition égale, OU la carte mise en avant en mode focus), `order` = position dans le flux
 * (`style.order`), pilote l'agencement sans dépendre de l'ordre du DOM (utile pour `HistoryComponent`,
 * dont les panneaux réels sont rendus par un composant `display:contents` distinct de
 * `DashboardComponent`, voir sa doc de tête). */
export interface DashboardGridSlot {
  readonly key: DashboardGridKey;
  readonly visible: boolean;
  readonly span2: boolean;
  readonly order: number;
}

export interface DashboardLayoutPrefs {
  readonly menuPos: DashboardMenuPos;
  readonly kpiPos: DashboardKpiPos;
  readonly bodyMode: DashboardBodyMode;
  readonly focusTarget: DashboardBodySlotKey;
  readonly historySplit: Readonly<Record<DashboardHistoryKey, boolean>>;
  readonly collapsedSections: Readonly<Partial<Record<DashboardCollapsibleKey, boolean>>>;
}

const DASHBOARD_LAYOUT_KEY = 'wakfu-dashboard-layout';

const DEFAULT_PREFS: DashboardLayoutPrefs = {
  menuPos: 'left',
  kpiPos: 'top',
  bodyMode: 'equal',
  focusTarget: 'combat',
  historySplit: { combats: false, purchases: false, trades: false },
  collapsedSections: {},
};

const HIST_KEYS: readonly DashboardHistoryKey[] = ['combats', 'purchases', 'trades'];
const ALL_GRID_KEYS: readonly DashboardGridKey[] = [
  'tracker',
  'combat',
  'hist_combats',
  'hist_purchases',
  'hist_trades',
  'hist_group',
  'chat',
];

/**
 * Préférence de disposition du tableau de bord (Profil › Personnalisation) — préférence d'affichage
 * locale (même principe que `ThemeService`/`ColorblindService` : stockée via `PersistenceService`,
 * pas synchronisée sur le compte, ce n'est pas une des six données couvertes par
 * `user-data.keys.ts`).
 *
 * Porte l'état choisi par l'utilisateur (persisté, exposé en signaux) ET la dérivation partagée
 * (quelles cartes du corps sont visibles, quel mode s'applique réellement, comment se placent-elles
 * dans `.panels-row`) — consommée à la fois par `DashboardLayoutPickerComponent` (Profil ›
 * Personnalisation, avec ses propres libellés traduits) et par le VRAI tableau de bord
 * (`DashboardComponent`/`DashboardRailComponent`/`TrackerStripComponent`/`HistoryComponent`), pour
 * n'avoir qu'un seul calcul de la disposition.
 *
 * Combat et Chat ont DÉJÀ leur propre notion de repli (`CombatPanelService`/`ChatPanelService`,
 * synchronisée sur le compte, pilote aussi `DashboardRailComponent`) — `isCollapsed`/
 * `toggleCollapsed` délèguent donc à ces services pour ces deux clés plutôt que de dupliquer un
 * second état déconnecté du premier (qui désynchroniserait le rail des icônes repliées et la
 * grille du corps).
 */
@Injectable({ providedIn: 'root' })
export class DashboardLayoutService {
  private readonly persistence = inject(PersistenceService);
  private readonly combatPanel = inject(CombatPanelService);
  private readonly chatPanel = inject(ChatPanelService);

  readonly menuPos = signal<DashboardMenuPos>(DEFAULT_PREFS.menuPos);
  readonly kpiPos = signal<DashboardKpiPos>(DEFAULT_PREFS.kpiPos);
  readonly bodyMode = signal<DashboardBodyMode>(DEFAULT_PREFS.bodyMode);
  readonly focusTarget = signal<DashboardBodySlotKey>(DEFAULT_PREFS.focusTarget);
  readonly historySplit = signal<Record<DashboardHistoryKey, boolean>>({
    ...DEFAULT_PREFS.historySplit,
  });
  /** Repli de Menu/Objectifs/Historique — PAS Combat/Chat, voir doc de tête (délégué). */
  readonly collapsedSections = signal<Partial<Record<DashboardCollapsibleKey, boolean>>>({});

  constructor() {
    const stored = this.persistence.getJson<Partial<DashboardLayoutPrefs>>(DASHBOARD_LAYOUT_KEY);
    if (stored) {
      if (stored.menuPos) this.menuPos.set(stored.menuPos);
      if (stored.kpiPos) this.kpiPos.set(stored.kpiPos);
      if (stored.bodyMode) this.bodyMode.set(stored.bodyMode);
      if (stored.focusTarget) this.focusTarget.set(stored.focusTarget);
      if (stored.historySplit) {
        this.historySplit.set({ ...DEFAULT_PREFS.historySplit, ...stored.historySplit });
      }
      if (stored.collapsedSections) this.collapsedSections.set({ ...stored.collapsedSections });
    }

    // Persistance en un seul bloc JSON (plutôt qu'une clé par champ comme ThemeService) : ces
    // champs forment une seule préférence cohérente, jamais lus/écrits indépendamment les uns des
    // autres. `effect()` posé APRÈS l'hydratation ci-dessus : les `.set()` de restauration ne
    // déclenchent donc pas une réécriture immédiate et inutile.
    effect(() => {
      const snapshot: DashboardLayoutPrefs = {
        menuPos: this.menuPos(),
        kpiPos: this.kpiPos(),
        bodyMode: this.bodyMode(),
        focusTarget: this.focusTarget(),
        historySplit: this.historySplit(),
        collapsedSections: this.collapsedSections(),
      };
      this.persistence.setJson(DASHBOARD_LAYOUT_KEY, snapshot);
    });
  }

  setMenuPos(value: DashboardMenuPos): void {
    this.menuPos.set(value);
  }
  setKpiPos(value: DashboardKpiPos): void {
    this.kpiPos.set(value);
  }
  setBodyMode(value: DashboardBodyMode): void {
    this.bodyMode.set(value);
  }
  setFocusTarget(value: DashboardBodySlotKey): void {
    this.focusTarget.set(value);
  }
  toggleHistorySplit(key: DashboardHistoryKey): void {
    this.historySplit.update((cur) => ({ ...cur, [key]: !cur[key] }));
  }

  isCollapsed(key: DashboardCollapsibleKey): boolean {
    if (key === 'combat') return this.combatPanel.collapsed();
    if (key === 'chat') return this.chatPanel.collapsed();
    return !!this.collapsedSections()[key];
  }
  toggleCollapsed(key: DashboardCollapsibleKey): void {
    if (key === 'combat') {
      this.combatPanel.setCollapsed(!this.combatPanel.collapsed());
      return;
    }
    if (key === 'chat') {
      this.chatPanel.setCollapsed(!this.chatPanel.collapsed());
      return;
    }
    this.collapsedSections.update((cur) => ({ ...cur, [key]: !cur[key] }));
  }

  reset(): void {
    this.menuPos.set(DEFAULT_PREFS.menuPos);
    this.kpiPos.set(DEFAULT_PREFS.kpiPos);
    this.bodyMode.set(DEFAULT_PREFS.bodyMode);
    this.focusTarget.set(DEFAULT_PREFS.focusTarget);
    this.historySplit.set({ ...DEFAULT_PREFS.historySplit });
    this.collapsedSections.set({});
  }

  // --- Dérivation partagée (corps : Combat / Historique×N / Chat) ---------------------------

  /** Cartes potentielles du corps, dans l'ordre — jamais plus de 3 liées à l'historique. Combat
   * n'y figure que pendant un combat réellement en cours (`combatPanel.hasActiveFight`),
   * indépendamment de son repli (voir `visibleBodySlots`, qui applique le repli en plus). */
  readonly activeSlots = computed<DashboardBodySlot[]>(() => {
    const slots: DashboardBodySlot[] = [];
    if (this.combatPanel.hasActiveFight()) slots.push({ key: 'combat', sw: 'combat' });
    const split = this.historySplit();
    const splitOnes = HIST_KEYS.filter((k) => split[k]);
    const remaining = HIST_KEYS.filter((k) => !split[k]);
    for (const k of splitOnes) {
      slots.push({ key: `hist_${k}` as DashboardBodySlotKey, sw: 'history' });
    }
    if (remaining.length > 0) slots.push({ key: 'hist_group', sw: 'history' });
    slots.push({ key: 'chat', sw: 'chat' });
    return slots;
  });

  /** Mêmes cartes, Combat toujours inclus (même hors combat) — pour proposer une cible de mise en
   * avant même indisponible dans l'immédiat (repli automatique tant qu'elle ne l'est pas, voir
   * `effectiveBodyMode`). */
  readonly chipSlots = computed<DashboardBodySlot[]>(() => {
    const active = this.activeSlots();
    if (active.some((s) => s.key === 'combat')) return active;
    return [{ key: 'combat', sw: 'combat' }, ...active];
  });

  /** Cartes réellement visibles : `activeSlots` moins celles repliées manuellement. */
  readonly visibleBodySlots = computed(() =>
    this.activeSlots().filter((s) => !this.isCollapsed(s.key)),
  );

  readonly effectiveBodyMode = computed<DashboardBodyMode>(() => {
    if (this.bodyMode() !== 'focus') return 'equal';
    return this.visibleBodySlots().some((s) => s.key === this.focusTarget()) ? 'focus' : 'equal';
  });

  /** Placement calculé de CHAQUE case possible de `.panels-row` (voir `DashboardGridSlot`) — Suivi
   * n'y participe PAS : `TrackerComponent` est `display:none` en desktop, quel que soit ce plan
   * (remplacé par `TrackerStripComponent`, voir CLAUDE.md/dashboard.component.html) — l'inclure
   * dans le compte fausserait `panelsRowCount` (une case "invisible" y consommerait quand même une
   * ligne). Sa clé reste dans `DashboardGridKey`/`ALL_GRID_KEYS` (toujours `{visible:false}` par
   * défaut ci-dessous) uniquement pour que le template puisse lui appliquer les mêmes bindings sans
   * cas particulier, sans effet puisqu'il ne se rend jamais en desktop.
   *
   * Répartition égale : grille à 2 colonnes max, le dernier élément d'un total impair prend toute
   * la largeur de sa ligne. Mise en avant : la carte ciblée occupe sa PROPRE ligne en tête, pleine
   * largeur ; les autres (les "secondaires") suivent dans l'ordre normal (2 colonnes) en dessous —
   * MÊME règle "dernier élément impair en pleine largeur" appliquée à ce sous-groupe de secondaires
   * (pas à l'ensemble cible+secondaires) : sans ça, une secondaire seule dans sa ligne (ex. Chat qui
   * vient de se replier, ne laissant plus qu'une seule secondaire) resterait à moitié largeur avec
   * une case vide à côté — bug réel constaté à la vérification. `panelsRowCount` (juste en dessous)
   * applique le même détail : la ligne de la cible ciblée compte à part, 1 + `ceil(secondaires / 2)`,
   * pas `ceil(total / 2)` (qui sous-compte dès que le nombre de secondaires est impair). */
  readonly gridPlan = computed<Record<DashboardGridKey, DashboardGridSlot>>(() => {
    const plan = {} as Record<DashboardGridKey, DashboardGridSlot>;
    for (const key of ALL_GRID_KEYS) plan[key] = { key, visible: false, span2: false, order: 0 };

    const items: DashboardGridKey[] = this.visibleBodySlots().map((s) => s.key);
    if (this.effectiveBodyMode() === 'focus') {
      const target = this.focusTarget();
      plan[target] = { key: target, visible: true, span2: true, order: 0 };
      const secondaries = items.filter((k) => k !== target);
      const m = secondaries.length;
      secondaries.forEach((key, i) => {
        plan[key] = { key, visible: true, span2: m % 2 === 1 && i === m - 1, order: i + 1 };
      });
    } else {
      const n = items.length;
      items.forEach((key, i) => {
        plan[key] = { key, visible: true, span2: n % 2 === 1 && i === n - 1, order: i };
      });
    }
    return plan;
  });

  /** Nombre de lignes à donner à `.panels-row` (`grid-template-rows`, voir DashboardComponent) —
   * toujours 2 colonnes max, donc `ceil(n / 2)` lignes pour `n` cases visibles en répartition égale
   * (Suivi exclu, voir `gridPlan`). En mise en avant, la cible occupe sa propre ligne (+1), le reste
   * se répartit ensuite à 2 colonnes — même raison que `gridPlan` ci-dessus. Au moins 1 (une grille
   * à 0 ligne n'a pas de sens même si `n` vaut 0). */
  readonly panelsRowCount = computed(() => {
    const n = this.visibleBodySlots().length;
    if (n === 0) return 1;
    if (this.effectiveBodyMode() === 'focus') return 1 + Math.ceil((n - 1) / 2);
    return Math.max(1, Math.ceil(n / 2));
  });
}
