import { Injectable, effect, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';

export type DashboardMenuPos = 'left' | 'right' | 'top-left' | 'top-right';
export type DashboardKpiPos = 'top' | 'bottom' | 'left' | 'right';
export type DashboardBodyMode = 'equal' | 'focus';
export type DashboardHistoryKey = 'combats' | 'purchases' | 'trades';

/** Identifiant d'une "carte" potentielle du corps — `'hist_group'` désigne le bloc Historique
 * restant après découpage (voir `DashboardLayoutPickerComponent.computeSlots`), son identité change
 * de contenu mais pas de clé selon `historySplit`. */
export type DashboardBodySlotKey =
  'combat' | 'hist_combats' | 'hist_purchases' | 'hist_trades' | 'hist_group' | 'chat';

/** Section repliable individuellement — le menu et les objectifs en plus des cartes du corps (voir
 * `DashboardBodySlotKey`), car eux aussi peuvent se réduire (bande d'icônes) même si leur repli ne
 * libère pas la même quantité d'espace (voir `DashboardLayoutPickerComponent`). */
export type DashboardCollapsibleKey = 'menu' | 'kpi' | DashboardBodySlotKey;

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

/**
 * Préférence de disposition du tableau de bord (Profil › Personnalisation) — préférence d'affichage
 * locale (même principe que `ThemeService`/`ColorblindService` : stockée via `PersistenceService`,
 * pas synchronisée sur le compte, ce n'est pas une des six données couvertes par
 * `user-data.keys.ts`).
 *
 * Ne fait QUE porter l'état choisi par l'utilisateur (persisté, exposé en signaux) — la dérivation
 * (quelles cartes sont visibles, quel mode s'applique réellement...) vit dans
 * `DashboardLayoutPickerComponent`, seul consommateur actuel. Le vrai tableau de bord
 * (`DashboardComponent`/`DashboardRailComponent`/`TrackerStripComponent`/`HistoryComponent`) ne lit
 * pas encore ces préférences — cette page ne fait pour l'instant que les proposer et les mémoriser
 * (voir CLAUDE.md pour le contexte de cette fonctionnalité).
 */
@Injectable({ providedIn: 'root' })
export class DashboardLayoutService {
  readonly menuPos = signal<DashboardMenuPos>(DEFAULT_PREFS.menuPos);
  readonly kpiPos = signal<DashboardKpiPos>(DEFAULT_PREFS.kpiPos);
  readonly bodyMode = signal<DashboardBodyMode>(DEFAULT_PREFS.bodyMode);
  readonly focusTarget = signal<DashboardBodySlotKey>(DEFAULT_PREFS.focusTarget);
  readonly historySplit = signal<Record<DashboardHistoryKey, boolean>>({
    ...DEFAULT_PREFS.historySplit,
  });
  readonly collapsedSections = signal<Partial<Record<DashboardCollapsibleKey, boolean>>>({});

  constructor(private readonly persistence: PersistenceService) {
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
    return !!this.collapsedSections()[key];
  }
  toggleCollapsed(key: DashboardCollapsibleKey): void {
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
}
