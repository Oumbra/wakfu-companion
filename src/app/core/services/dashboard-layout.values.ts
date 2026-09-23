import type {
  DashboardBodyMode,
  DashboardBodySlotKey,
  DashboardFocusSide,
  DashboardKpiPos,
  DashboardMenuPos,
} from './dashboard-layout.service';

/**
 * Valeurs connues des champs scalaires de `dashboardLayout` — un `Record<Type, true>` plutôt qu'un
 * simple tableau : ajouter une valeur à l'union TypeScript sans l'ajouter ici casse la compilation
 * (clé manquante), donc la garde ne peut pas dériver silencieusement du type.
 *
 * Module sans dépendance d'exécution (import de TYPES seulement) : lu à la fois par
 * `DashboardLayoutService.applyStored` et par `user-data.validation.ts` (données venant du compte,
 * d'un import de fichier ou d'un vieux localStorage), sans créer de cycle d'import entre la couche
 * données et le service.
 */
const MENU_POS: Record<DashboardMenuPos, true> = {
  left: true,
  right: true,
  'top-left': true,
  'top-right': true,
};
const KPI_POS: Record<DashboardKpiPos, true> = { top: true, bottom: true, left: true, right: true };
const BODY_MODE: Record<DashboardBodyMode, true> = { equal: true, focus: true };
const FOCUS_SIDE: Record<DashboardFocusSide, true> = { left: true, right: true };
/** Pas de `'combat'` : ancienne carte « combat en cours » supprimée (voir `DashboardBodySlotKey`)
 * — une valeur persistée localement/importée avant cette suppression retombe sur le défaut. */
const FOCUS_TARGET: Record<DashboardBodySlotKey, true> = {
  hist_combats: true,
  hist_purchases: true,
  hist_trades: true,
  hist_pacts: true,
  hist_group: true,
  chat: true,
  recap: true,
};

function isKeyOf<T extends string>(table: Record<T, true>, value: unknown): value is T {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(table, value);
}

export const isDashboardMenuPos = (v: unknown): v is DashboardMenuPos => isKeyOf(MENU_POS, v);
export const isDashboardKpiPos = (v: unknown): v is DashboardKpiPos => isKeyOf(KPI_POS, v);
export const isDashboardBodyMode = (v: unknown): v is DashboardBodyMode => isKeyOf(BODY_MODE, v);
export const isDashboardFocusSide = (v: unknown): v is DashboardFocusSide => isKeyOf(FOCUS_SIDE, v);
export const isDashboardFocusTarget = (v: unknown): v is DashboardBodySlotKey =>
  isKeyOf(FOCUS_TARGET, v);

/** Garde par champ scalaire de `dashboardLayout` — partagée entre la validation des données
 * utilisateur et `applyStored`. */
export const DASHBOARD_LAYOUT_SCALAR_GUARDS = {
  menuPos: isDashboardMenuPos,
  kpiPos: isDashboardKpiPos,
  bodyMode: isDashboardBodyMode,
  focusTarget: isDashboardFocusTarget,
  focusSide: isDashboardFocusSide,
} as const satisfies Record<string, (v: unknown) => boolean>;
