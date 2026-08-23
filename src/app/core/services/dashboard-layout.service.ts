import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';
import { CombatPanelService } from './combat-panel.service';
import { ChatPanelService } from './chat-panel.service';

export type DashboardMenuPos = 'left' | 'right' | 'top-left' | 'top-right';
export type DashboardKpiPos = 'top' | 'bottom' | 'left' | 'right';
export type DashboardBodyMode = 'equal' | 'focus';
/** Côté où se rangent les cartes secondaires en mode "mise en avant" — la carte ciblée occupe
 * l'AUTRE côté, en pleine hauteur (voir `gridPlan`). */
export type DashboardFocusSide = 'left' | 'right';
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
  readonly historySplit: Readonly<Record<DashboardHistoryKey, boolean>>;
  readonly collapsedSections: Readonly<Partial<Record<DashboardCollapsibleKey, boolean>>>;
}

const DASHBOARD_LAYOUT_KEY = 'wakfu-dashboard-layout';

const DEFAULT_PREFS: DashboardLayoutPrefs = {
  menuPos: 'left',
  kpiPos: 'top',
  bodyMode: 'equal',
  focusTarget: 'combat',
  focusSide: 'right',
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
 * grille du corps). Toutes les autres cartes du corps (Historique groupé et chacune de ses
 * scissions) sont repliables de la MÊME façon (`.collapse-btn` sur leur panneau, voir
 * `HistoryComponent`) et rejoignent elles aussi `DashboardRailComponent`, généralisé pour lister
 * dynamiquement toute carte repliée plutôt que seulement Combat/Chat.
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
  readonly focusSide = signal<DashboardFocusSide>(DEFAULT_PREFS.focusSide);
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
      if (stored.focusSide) this.focusSide.set(stored.focusSide);
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
        focusSide: this.focusSide(),
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
  setFocusSide(value: DashboardFocusSide): void {
    this.focusSide.set(value);
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
    this.focusSide.set(DEFAULT_PREFS.focusSide);
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

  /** Colonnes de `.panels-row` (`grid-template-columns`, posé en inline depuis DashboardComponent) —
   * 2 colonnes égales en répartition égale ; en mise en avant, une colonne étroite (les secondaires,
   * empilées) et une large (la cible, ~2x plus large — mêmes proportions que la maquette validée
   * avec l'utilisateur), du côté choisi (`focusSide`). */
  readonly panelsColumns = computed<string>(() => {
    if (this.effectiveBodyMode() !== 'focus') return 'repeat(2, minmax(0, 1fr))';
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
      const mainCol = this.focusSide() === 'left' ? '2' : '1';
      const secCol = this.focusSide() === 'left' ? '1' : '2';
      const secondaries = items.filter((k) => k !== target);
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
