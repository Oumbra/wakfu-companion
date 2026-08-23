import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { CombatPanelService } from '../../core/services/combat-panel.service';
import { ChatPanelService } from '../../core/services/chat-panel.service';
import { UserDataService } from '../../core/data-access/user-data.service';
import { I18nService } from '../../core/services/i18n.service';
import {
  DashboardBodySlotKey,
  DashboardLayoutService,
} from '../../core/services/dashboard-layout.service';
import { dashboardBodySlotLabel } from '../../core/services/dashboard-body-slot-label';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { AppIconName, IconComponent } from '../../shared/icon/icon.component';

interface RailEntry {
  id: DashboardBodySlotKey;
  label: string;
  expandHint: string;
  icon: AppIconName;
  count: number | null;
}

/** Clé i18n de l'infobulle "agrandir" par type de carte — `history.expandHint` couvre le panneau
 * groupé ET chacune de ses scissions (même libellé générique, comme `history.collapseHint`). */
function expandHintKeyFor(key: DashboardBodySlotKey): string {
  if (key === 'combat') return 'damageMeter.expandHint';
  if (key === 'chat') return 'chat.expandHint';
  return 'history.expandHint';
}
function iconFor(key: DashboardBodySlotKey): AppIconName {
  if (key === 'combat') return 'crossed-swords';
  if (key === 'chat') return 'messages-square';
  return 'clock';
}

/**
 * Rail d'icônes du dashboard : liste TOUTE carte du corps actuellement repliée (Combat, Chat,
 * Historique groupé ou l'une de ses scissions — voir `DashboardLayoutService.activeSlots`/
 * `isCollapsed`, généralisé pour ne plus se limiter à Combat/Chat), cliquable pour la réagrandir.
 * Combat/Chat restent délégués à leurs services dédiés (`CombatPanelService`/`ChatPanelService`,
 * synchronisés compte) via `DashboardLayoutService.isCollapsed`/`toggleCollapsed` — ce composant ne
 * distingue plus les deux cas, tout passe par le même mécanisme générique.
 */
@Component({
  selector: 'app-dashboard-rail',
  imports: [TooltipDirective, IconComponent],
  templateUrl: './dashboard-rail.component.html',
  styleUrl: './dashboard-rail.component.css',
})
export class DashboardRailComponent {
  protected readonly combatPanel = inject(CombatPanelService);
  protected readonly chatPanel = inject(ChatPanelService);
  protected readonly i18n = inject(I18nService);
  protected readonly layout = inject(DashboardLayoutService);
  private readonly userData = inject(UserDataService);

  protected readonly isRailCollapsed = signal<boolean>(
    this.userData.read<boolean>('dashboardRailCollapsed') ?? false,
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    const unsubscribe = this.userData.onExternalChange('dashboardRailCollapsed', () =>
      this.isRailCollapsed.set(this.userData.read<boolean>('dashboardRailCollapsed') ?? false),
    );
    destroyRef.onDestroy(unsubscribe);
  }

  /** Côté d'affichage des tooltips du rail — dépend de `layout.menuPos()` : un rail collé au bord
   * DROIT de l'écran (`menuPos === 'right'`) doit ouvrir ses tooltips vers la GAUCHE, sans quoi ils
   * sortiraient de la fenêtre (illisibles/tronqués). Rail horizontal (`top-left`/`top-right`, sous
   * l'en-tête) : `bottom`, même convention que tout élément de header (voir CLAUDE.md). */
  protected readonly railTooltipPosition = computed<'left' | 'right' | 'bottom'>(() => {
    const pos = this.layout.menuPos();
    if (pos === 'right') return 'left';
    if (pos === 'top-left' || pos === 'top-right') return 'bottom';
    return 'right';
  });

  protected readonly entries = computed<RailEntry[]>(() => {
    const historySplit = this.layout.historySplit();
    return this.layout
      .activeSlots()
      .filter((slot) => this.layout.isCollapsed(slot.key))
      .map((slot) => ({
        id: slot.key,
        label: dashboardBodySlotLabel(this.i18n, historySplit, slot.key),
        expandHint: this.i18n.t(expandHintKeyFor(slot.key)),
        icon: iconFor(slot.key),
        count:
          slot.key === 'combat'
            ? this.combatPanel.activeFightCount()
            : slot.key === 'chat'
              ? this.chatPanel.matchedMessageCount() || null
              : null,
      }));
  });

  protected toggleRailCollapsed(): void {
    const next = !this.isRailCollapsed();
    this.isRailCollapsed.set(next);
    this.userData.write('dashboardRailCollapsed', next);
  }

  protected expand(id: DashboardBodySlotKey): void {
    this.layout.toggleCollapsed(id);
  }
}
