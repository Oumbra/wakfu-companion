import { I18nService } from './i18n.service';
import { DashboardBodySlotKey, DashboardHistoryKey } from './dashboard-layout.service';
import { AppIconName } from '../../shared/icon/icon.component';

const HIST_KEYS: readonly DashboardHistoryKey[] = ['combats', 'purchases', 'trades'];

/** Clé i18n du libellé d'un volet d'historique seul (pas le libellé traduit) — exportée pour
 * `DashboardLayoutPickerComponent`, qui en a besoin telle quelle pour ses 3 lignes de découpage
 * (le texte du switch, pas un label de carte complet). */
export function histLabelKey(key: DashboardHistoryKey): string {
  return key === 'combats'
    ? 'profile.dashboardLayout.slot.histCombats'
    : 'profile.dashboardLayout.slot.' + key;
}

/** Libellé traduit d'une carte du corps (Historique×N/Chat) — utilisé à la fois par
 * `DashboardLayoutPickerComponent` (Profil › Personnalisation) et par `DashboardRailComponent` (le
 * VRAI rail, dont les entrées listent désormais toutes les cartes repliées, pas seulement Chat) :
 * un seul calcul, `DashboardLayoutService` lui-même ne connaît pas l'i18n (voir sa doc de tête) donc
 * ne peut pas le porter directement. `historySplit` passé explicitement (pas lu depuis
 * `DashboardLayoutService` ici) pour rester une fonction pure, facile à appeler depuis un `computed`
 * sans dépendance cachée. */
export function dashboardBodySlotLabel(
  i18n: I18nService,
  historySplit: Readonly<Record<DashboardHistoryKey, boolean>>,
  key: DashboardBodySlotKey,
): string {
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

/** Icône par type de carte du corps — chaque volet d'historique a la sienne (voir `icons-*.svg`),
 * pour rester différenciable partout où le libellé n'est pas (ou plus) visible : rail replié
 * (`DashboardRailComponent`) ET en-tête d'un panneau scindé à part (`HistoryComponent`, à la place
 * de l'horloge générique auparavant utilisée pour les 3 volets indifféremment). `clock` reste
 * utilisée pour le panneau groupé (mélange de volets, pas d'icône plus spécifique pertinente) ;
 * `shopping-bag`/`arrows-exchange` pour Achats/Échanges. */
export function dashboardBodySlotIcon(key: DashboardBodySlotKey): AppIconName {
  if (key === 'hist_combats') return 'crossed-swords';
  if (key === 'chat') return 'messages-square';
  if (key === 'hist_purchases') return 'shopping-bag';
  if (key === 'hist_trades') return 'arrows-exchange';
  return 'clock';
}
