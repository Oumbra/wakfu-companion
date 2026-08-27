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
 * ne peut pas le porter directement. `historyGroup` passé explicitement (pas lu depuis
 * `DashboardLayoutService` ici) pour rester une fonction pure, facile à appeler depuis un `computed`
 * sans dépendance cachée. Idem pour `isAuthenticated` (pas lu depuis `AuthService` ici) : la carte
 * Récap n'a plus de titre fixe une fois connectée (switch Session/Jour/Mois/Année, "Récap" plutôt
 * que "Récap. de la session" — voir `sessionRecap.titleGeneric`, même bascule que
 * `SessionRecapComponent.html`), les deux appelants doivent lui passer `auth.isAuthenticated()`. */
export function dashboardBodySlotLabel(
  i18n: I18nService,
  historyGroup: Readonly<Record<DashboardHistoryKey, boolean>>,
  key: DashboardBodySlotKey,
  isAuthenticated: boolean,
): string {
  if (key === 'chat') return i18n.t('profile.dashboardLayout.slot.chat');
  if (key === 'recap') {
    return isAuthenticated
      ? i18n.t('sessionRecap.titleGeneric')
      : i18n.t('profile.dashboardLayout.slot.recap');
  }
  if (key === 'hist_group') {
    // N'est appelé pour cette clé que quand le regroupement est actif (voir
    // `DashboardLayoutService.activeSlots`, au moins 2 volets cochés) — `grouped` a donc toujours
    // 2 ou 3 éléments ici.
    const grouped = HIST_KEYS.filter((k) => historyGroup[k]);
    return grouped.length === 3
      ? i18n.t('profile.dashboardLayout.slot.histGroupFull')
      : i18n.t('profile.dashboardLayout.slot.histGroupPartial', {
          parts: grouped.map((k) => i18n.t(histLabelKey(k))).join(' + '),
        });
  }
  // 'hist_combats' | 'hist_purchases' | 'hist_trades'
  const histKey = key.slice('hist_'.length) as DashboardHistoryKey;
  return i18n.t(histLabelKey(histKey));
}

/** Libellé COURT d'une carte du corps — contrairement à `dashboardBodySlotLabel` (qui détaille la
 * composition d'une carte groupée, ex. "Historique (Achats + Échanges)", potentiellement long),
 * toujours un seul mot ou presque : utilisé partout où la place est comptée au pixel près (le texte
 * posé DANS une vignette colorée de `DashboardLayoutSchemaComponent`, voir
 * `DashboardLayoutPickerComponent.previewCells`/`previewFocus`) — `hist_group` retombe sur le même
 * "Historique" générique qu'elle soit partiellement ou totalement regroupée, l'appelant qui a besoin
 * du détail utilise `dashboardBodySlotLabel` à la place. */
export function shortSlotLabelKey(key: DashboardBodySlotKey): string {
  if (key === 'chat') return 'profile.dashboardLayout.slot.chat';
  if (key === 'recap') return 'profile.dashboardLayout.slot.recap';
  if (key === 'hist_group') return 'profile.dashboardLayout.slot.histGroupFull';
  return histLabelKey(key.slice('hist_'.length) as DashboardHistoryKey);
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
  if (key === 'recap') return 'scroll';
  return 'clock';
}
