import { I18nService } from './i18n.service';
import { DashboardBodySlotKey, DashboardHistoryKey } from './dashboard-layout.service';

const HIST_KEYS: readonly DashboardHistoryKey[] = ['combats', 'purchases', 'trades'];

/** Clé i18n du libellé d'un volet d'historique seul (pas le libellé traduit) — exportée pour
 * `DashboardLayoutPickerComponent`, qui en a besoin telle quelle pour ses 3 lignes de découpage
 * (le texte du switch, pas un label de carte complet). */
export function histLabelKey(key: DashboardHistoryKey): string {
  return key === 'combats'
    ? 'profile.dashboardLayout.slot.histCombats'
    : 'profile.dashboardLayout.slot.' + key;
}

/** Libellé traduit d'une carte du corps (Combat/Historique×N/Chat) — utilisé à la fois par
 * `DashboardLayoutPickerComponent` (Profil › Personnalisation) et par `DashboardRailComponent` (le
 * VRAI rail, dont les entrées listent désormais toutes les cartes repliées, pas seulement Combat/
 * Chat) : un seul calcul, `DashboardLayoutService` lui-même ne connaît pas l'i18n (voir sa doc de
 * tête) donc ne peut pas le porter directement. `historySplit` passé explicitement (pas lu depuis
 * `DashboardLayoutService` ici) pour rester une fonction pure, facile à appeler depuis un `computed`
 * sans dépendance cachée. */
export function dashboardBodySlotLabel(
  i18n: I18nService,
  historySplit: Readonly<Record<DashboardHistoryKey, boolean>>,
  key: DashboardBodySlotKey,
): string {
  if (key === 'combat') return i18n.t('profile.dashboardLayout.slot.combat');
  if (key === 'chat') return i18n.t('profile.dashboardLayout.slot.chat');
  if (key === 'hist_group') {
    const remaining = HIST_KEYS.filter((k) => !historySplit[k]);
    return remaining.length === 3
      ? i18n.t('profile.dashboardLayout.slot.histGroupFull')
      : i18n.t('profile.dashboardLayout.slot.histGroupPartial', {
          parts: remaining.map((k) => i18n.t(histLabelKey(k))).join(' + '),
        });
  }
  // 'hist_combats' | 'hist_purchases' | 'hist_trades'
  const histKey = key.slice('hist_'.length) as DashboardHistoryKey;
  return i18n.t(histLabelKey(histKey));
}
