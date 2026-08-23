import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '../../../shared/translate.pipe';
import { IconComponent } from '../../../shared/icon/icon.component';
import { SwitchComponent } from '../../../shared/switch/switch.component';
import {
  DashboardLayoutSchemaCell,
  DashboardLayoutSchemaComponent,
  DashboardLayoutSchemaFocus,
  DashboardKpiPos,
  DashboardMenuPos,
} from '../../../shared/dashboard-layout-schema/dashboard-layout-schema.component';
import { I18nService } from '../../../core/services/i18n.service';
import {
  DashboardBodySlot,
  DashboardBodySlotKey,
  DashboardFocusSide,
  DashboardHistoryKey,
  DashboardLayoutService,
} from '../../../core/services/dashboard-layout.service';
import {
  dashboardBodySlotLabel,
  histLabelKey,
} from '../../../core/services/dashboard-body-slot-label';

interface LabeledSlot extends DashboardBodySlot {
  readonly label: string;
}

interface OptionCard<T extends string> {
  readonly value: T;
  readonly nameKey: string;
  readonly descKey: string;
  readonly isDefault?: boolean;
}

const HIST_KEYS: readonly DashboardHistoryKey[] = ['combats', 'purchases', 'trades'];

/** Illustration fixe des vignettes de préréglage (menu/objectifs/corps) — indépendante du choix
 * réel de l'utilisateur, seulement là pour montrer la forme générale de chaque option (voir
 * `DashboardLayoutSchemaComponent`, purement décoratif, pas de libellé rendu dans les cases).
 * Reprend le défaut réel (Combats/Achats/Échanges chacun leur carte, voir CLAUDE.md) plutôt qu'un
 * regroupement — chaque volet dans sa propre couleur (voir `dashboard-layout-schema.component.css`). */
const THUMB_CELLS: readonly DashboardLayoutSchemaCell[] = [
  { sw: 'combats' },
  { sw: 'purchases' },
  { sw: 'trades' },
  { sw: 'chat' },
];
const THUMB_FOCUS: DashboardLayoutSchemaFocus = {
  main: { sw: 'combats' },
  secondaries: [{ sw: 'purchases' }, { sw: 'trades' }, { sw: 'chat' }],
};

/**
 * Composeur de disposition du tableau de bord (Profil › Personnalisation) — trois réglages
 * indépendants (position du menu, position des objectifs, composition du corps) plus le découpage
 * de l'historique, avec aperçu en direct. La dérivation (cartes visibles, mode effectif, placement
 * dans la grille) vit dans `DashboardLayoutService`, partagée avec le VRAI tableau de bord qui
 * l'applique désormais (`DashboardComponent`/`DashboardRailComponent`/`TrackerStripComponent`/
 * `HistoryComponent`) — ce composant n'ajoute que les libellés traduits par-dessus (le service ne
 * connaît pas l'i18n).
 */
@Component({
  selector: 'app-dashboard-layout-picker',
  imports: [TranslatePipe, IconComponent, SwitchComponent, DashboardLayoutSchemaComponent],
  templateUrl: './dashboard-layout-picker.component.html',
  styleUrl: './dashboard-layout-picker.component.css',
})
export class DashboardLayoutPickerComponent {
  protected readonly layout = inject(DashboardLayoutService);
  protected readonly i18n = inject(I18nService);

  protected readonly thumbCells = THUMB_CELLS;
  protected readonly thumbFocus = THUMB_FOCUS;
  protected readonly histKeys = HIST_KEYS;

  protected readonly menuOptions: readonly OptionCard<DashboardMenuPos>[] = [
    {
      value: 'left',
      nameKey: 'profile.dashboardLayout.menu.left.name',
      descKey: 'profile.dashboardLayout.menu.left.desc',
      isDefault: true,
    },
    {
      value: 'right',
      nameKey: 'profile.dashboardLayout.menu.right.name',
      descKey: 'profile.dashboardLayout.menu.right.desc',
    },
    {
      value: 'top-left',
      nameKey: 'profile.dashboardLayout.menu.topLeft.name',
      descKey: 'profile.dashboardLayout.menu.topLeft.desc',
    },
    {
      value: 'top-right',
      nameKey: 'profile.dashboardLayout.menu.topRight.name',
      descKey: 'profile.dashboardLayout.menu.topRight.desc',
    },
  ];

  protected readonly kpiOptions: readonly OptionCard<DashboardKpiPos>[] = [
    {
      value: 'top',
      nameKey: 'profile.dashboardLayout.kpi.top.name',
      descKey: 'profile.dashboardLayout.kpi.top.desc',
      isDefault: true,
    },
    {
      value: 'bottom',
      nameKey: 'profile.dashboardLayout.kpi.bottom.name',
      descKey: 'profile.dashboardLayout.kpi.bottom.desc',
    },
    {
      value: 'left',
      nameKey: 'profile.dashboardLayout.kpi.left.name',
      descKey: 'profile.dashboardLayout.kpi.left.desc',
    },
    {
      value: 'right',
      nameKey: 'profile.dashboardLayout.kpi.right.name',
      descKey: 'profile.dashboardLayout.kpi.right.desc',
    },
  ];

  protected readonly bodyOptions: readonly OptionCard<'equal' | 'focus'>[] = [
    {
      value: 'equal',
      nameKey: 'profile.dashboardLayout.body.equal.name',
      descKey: 'profile.dashboardLayout.body.equal.desc',
      isDefault: true,
    },
    {
      value: 'focus',
      nameKey: 'profile.dashboardLayout.body.focus.name',
      descKey: 'profile.dashboardLayout.body.focus.desc',
    },
  ];

  /** Clé i18n du libellé d'un sous-onglet d'historique seul — utilisée directement par le template
   * pour les 3 lignes de découpage (résolu via le pipe `| t`). Libellé complet d'une carte du corps :
   * voir `dashboardBodySlotLabel` (partagé avec `DashboardRailComponent`). */
  protected histLabelKey(key: DashboardHistoryKey): string {
    return histLabelKey(key);
  }

  private label(slots: readonly DashboardBodySlot[]): LabeledSlot[] {
    const group = this.layout.historyGroup();
    return slots.map((s) => ({
      ...s,
      label: dashboardBodySlotLabel(this.i18n, group, s.key),
    }));
  }

  protected readonly activeSlots = computed<LabeledSlot[]>(() =>
    this.label(this.layout.activeSlots()),
  );
  protected readonly chipSlots = computed<LabeledSlot[]>(() => this.label(this.layout.chipSlots()));
  protected readonly visibleBodySlots = computed<LabeledSlot[]>(() =>
    this.label(this.layout.visibleBodySlots()),
  );
  protected readonly effectiveBodyMode = this.layout.effectiveBodyMode;

  protected readonly previewCells = computed<DashboardLayoutSchemaCell[] | null>(() => {
    if (this.effectiveBodyMode() !== 'equal') return null;
    const vis = this.visibleBodySlots();
    return vis.map((s, i) => ({ sw: s.sw, span2: vis.length % 2 === 1 && i === vis.length - 1 }));
  });
  protected readonly previewFocus = computed<DashboardLayoutSchemaFocus | null>(() => {
    if (this.effectiveBodyMode() !== 'focus') return null;
    const vis = this.visibleBodySlots();
    const main = vis.find((s) => s.key === this.layout.focusTarget());
    if (!main) return null;
    return {
      main: { sw: main.sw },
      secondaries: vis.filter((s) => s.key !== main.key).map((s) => ({ sw: s.sw })),
    };
  });

  /** Vrai quand exactement 1 volet est coché "à regrouper" — insuffisant pour activer le
   * regroupement (voir `DashboardLayoutService.activeSlots`, "au moins 2"), affiche un rappel sous
   * les 3 lignes plutôt que de laisser l'utilisateur penser que son clic n'a rien fait. */
  protected readonly needsSecondGroupPick = computed(
    () => HIST_KEYS.filter((k) => this.layout.historyGroup()[k]).length === 1,
  );

  protected readonly historySplitSummary = computed(() => {
    const slots = this.activeSlots().filter((s) => s.key.startsWith('hist'));
    const names = slots.map((s) => s.label).join(' · ');
    return slots.length <= 1
      ? this.i18n.t('profile.dashboardLayout.historySplitSummaryOne', { names })
      : this.i18n.t('profile.dashboardLayout.historySplitSummaryMany', {
          count: String(slots.length),
          names,
        });
  });

  protected readonly summaryMenuLabel = computed(() =>
    this.i18n.t(this.menuOptions.find((o) => o.value === this.layout.menuPos())!.nameKey),
  );
  protected readonly summaryKpiLabel = computed(() =>
    this.i18n.t(this.kpiOptions.find((o) => o.value === this.layout.kpiPos())!.nameKey),
  );
  protected readonly summaryBodyLabel = computed(() => {
    const vis = this.visibleBodySlots();
    const mode = this.effectiveBodyMode();
    if (vis.length === 0) return this.i18n.t('profile.dashboardLayout.summaryBodyEmpty');
    if (mode === 'focus') {
      const target = this.chipSlots().find((s) => s.key === this.layout.focusTarget());
      return this.i18n.t('profile.dashboardLayout.summaryBodyFocus', {
        target: target?.label ?? '',
      });
    }
    const key =
      vis.length === 1
        ? 'profile.dashboardLayout.summaryBodyEqualOne'
        : 'profile.dashboardLayout.summaryBodyEqualMany';
    const base = this.i18n.t(key, { count: String(vis.length) });
    if (this.layout.bodyMode() !== 'focus') return base;
    const target = this.chipSlots().find((s) => s.key === this.layout.focusTarget());
    return (
      base +
      ' ' +
      this.i18n.t('profile.dashboardLayout.summaryBodyFocusFallback', {
        target: target?.label ?? '',
      })
    );
  });

  protected isChipAvailable(key: DashboardBodySlotKey): boolean {
    return this.visibleBodySlots().some((s) => s.key === key);
  }

  protected chooseFocusTarget(key: DashboardBodySlotKey): void {
    this.layout.setFocusTarget(key);
  }

  /** Les deux côtés possibles pour les cartes secondaires en mode "mise en avant" (voir
   * `DashboardFocusSide`) — affiché uniquement quand `bodyMode() === 'focus'` (même bloc que le
   * choix de la cible, voir template). */
  protected readonly focusSideValues: readonly DashboardFocusSide[] = ['right', 'left'];
  protected focusSideLabelKey(side: DashboardFocusSide): string {
    return `profile.dashboardLayout.focusSide.${side}`;
  }
  protected chooseFocusSide(side: DashboardFocusSide): void {
    this.layout.setFocusSide(side);
  }
}
