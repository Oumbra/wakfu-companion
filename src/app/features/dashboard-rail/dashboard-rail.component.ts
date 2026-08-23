import { Component, computed, inject } from '@angular/core';
import { ChatPanelService } from '../../core/services/chat-panel.service';
import { I18nService } from '../../core/services/i18n.service';
import {
  DashboardBodySlotKey,
  DashboardLayoutService,
} from '../../core/services/dashboard-layout.service';
import {
  dashboardBodySlotIcon,
  dashboardBodySlotLabel,
} from '../../core/services/dashboard-body-slot-label';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { AppIconName, IconComponent } from '../../shared/icon/icon.component';

interface RailEntry {
  id: DashboardBodySlotKey;
  label: string;
  /** Texte complet d'infobulle : nom de la carte + indication "Agrandir" — le libellé n'étant
   * jamais affiché à côté de l'icône (rail toujours en icônes seules), c'est la seule façon pour
   * l'utilisateur de savoir ce que chaque icône représente sans avoir à cliquer dessus. */
  tooltipText: string;
  icon: AppIconName;
  count: number | null;
}

/** Clé i18n de l'infobulle "agrandir" par type de carte — `history.expandHint` couvre le panneau
 * groupé ET chacune de ses scissions (même libellé générique, comme `history.collapseHint`). */
function expandHintKeyFor(key: DashboardBodySlotKey): string {
  if (key === 'chat') return 'chat.expandHint';
  return 'history.expandHint';
}
/**
 * Rail d'icônes du dashboard : liste TOUTE carte du corps actuellement repliée (Chat, Historique
 * groupé ou l'une de ses scissions — voir `DashboardLayoutService.activeSlots`/`isCollapsed`,
 * généralisé pour ne plus se limiter à Chat), cliquable pour la réagrandir. Chat reste délégué à
 * son service dédié (`ChatPanelService`, synchronisé compte) via
 * `DashboardLayoutService.isCollapsed`/`toggleCollapsed` — ce composant ne distingue pas ce cas,
 * tout passe par le même mécanisme générique.
 *
 * Toujours affiché en icônes seules (positions latérales) — pas de repli manuel réglable par
 * l'utilisateur : contrairement à `.profile-rail`, ce rail-ci n'a jamais de mode "déplié" (retour
 * utilisateur : prend trop de place latéralement). Le nom de la carte, absent visuellement, est
 * reporté dans l'infobulle (voir `entries`/`tooltipText`) plutôt que perdu.
 */
@Component({
  selector: 'app-dashboard-rail',
  imports: [TooltipDirective, IconComponent],
  templateUrl: './dashboard-rail.component.html',
  styleUrl: './dashboard-rail.component.css',
})
export class DashboardRailComponent {
  protected readonly chatPanel = inject(ChatPanelService);
  protected readonly i18n = inject(I18nService);
  protected readonly layout = inject(DashboardLayoutService);

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
    const historyGroup = this.layout.historyGroup();
    return this.layout
      .activeSlots()
      .filter((slot) => this.layout.isCollapsed(slot.key))
      .map((slot) => {
        const label = dashboardBodySlotLabel(this.i18n, historyGroup, slot.key);
        return {
          id: slot.key,
          label,
          tooltipText: `${label} — ${this.i18n.t(expandHintKeyFor(slot.key))}`,
          icon: dashboardBodySlotIcon(slot.key),
          count: slot.key === 'chat' ? this.chatPanel.matchedMessageCount() || null : null,
        };
      });
  });

  protected expand(id: DashboardBodySlotKey): void {
    this.layout.toggleCollapsed(id);
  }
}
