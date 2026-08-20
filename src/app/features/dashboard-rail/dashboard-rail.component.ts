import { Component, computed, inject, signal } from '@angular/core';
import { CombatPanelService } from '../../core/services/combat-panel.service';
import { ChatPanelService } from '../../core/services/chat-panel.service';
import { PersistenceService } from '../../core/services/persistence.service';
import { I18nService } from '../../core/services/i18n.service';
import { HEADER_ICON_COMBAT_DATA_URI } from '../../core/data/header-icons.data';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { IconComponent } from '../../shared/icon/icon.component';

/** Local uniquement, même famille que `wakfu-combat-panel-collapsed`/`wakfu-chat-panel-collapsed`
 * (voir CombatPanelService/ChatPanelService) : juste un choix d'affichage côté navigateur. */
const RAIL_COLLAPSED_KEY = 'wakfu-dashboard-rail-collapsed';

type CollapsiblePanelId = 'combat' | 'chat';

interface RailEntry {
  id: CollapsiblePanelId;
  label: string;
  /** Toujours affiché en tooltip (contrairement à `.profile-rail-btn`, dont le tooltip
   * n'apparaît que rail replié — voir template) : contrairement à un simple changement d'onglet,
   * cliquer une entrée ici agrandit le panneau correspondant, une action qui vaut la peine d'être
   * rappelée même quand le libellé est déjà visible (rail déplié). */
  expandHint: string;
  /** Nombre de combats en cours (multi-compte) — `null` pour Chat, qui n'a pas cette notion. */
  count: number | null;
}

/**
 * Menu latéral des sections du dashboard repliées (Combat/Chat, desktop uniquement — voir
 * CombatPanelService/ChatPanelService) : chaque section repliée y devient un bouton icône+libellé,
 * cliquer dessus la déplie de nouveau. Remplace l'ancien `CombatEdgeTabComponent` (onglet flottant
 * `position: fixed`, root-level) — celui-ci ne gérait que Combat seul et ne pouvait pas se
 * généraliser à plusieurs sections repliées à la fois sans devenir une vraie mini-liste. Rendu en
 * flux normal (PAS `position: fixed`) au sein de `DashboardComponent`, comme `.profile-rail` dans
 * `ProfilePageComponent` — même principe de rail réductible en icônes seules
 * (`isRailCollapsed`/`toggleRailCollapsed`, voir CLAUDE.md).
 *
 * `:host { display: contents }` + `@if` englobant tout le template (voir dashboard-rail.component.html)
 * : n'occupe RIEN dans le flex `.dashboard-content` (voir dashboard.component.css) tant qu'aucune
 * section n'est repliée, plutôt qu'un rail vide qui gaspillerait de la largeur.
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
  private readonly persistence = inject(PersistenceService);

  protected readonly combatIcon = HEADER_ICON_COMBAT_DATA_URI;

  protected readonly isRailCollapsed = signal<boolean>(
    this.persistence.getJson<boolean>(RAIL_COLLAPSED_KEY) ?? false,
  );

  /** Une section n'apparaît dans le rail que si elle est effectivement repliée — Combat en plus
   * n'y figure que pendant un combat en cours (même condition que l'ancien CombatEdgeTabComponent,
   * `CombatPanelService.hasActiveFight` : replié sans combat actif n'a rien à montrer/agrandir). */
  protected readonly entries = computed<RailEntry[]>(() => {
    const list: RailEntry[] = [];
    if (this.combatPanel.collapsed() && this.combatPanel.hasActiveFight()) {
      list.push({
        id: 'combat',
        label: this.i18n.t('damageMeter.header'),
        expandHint: this.i18n.t('damageMeter.expandHint'),
        count: this.combatPanel.activeFightCount(),
      });
    }
    if (this.chatPanel.collapsed()) {
      list.push({
        id: 'chat',
        label: this.i18n.t('chat.header'),
        expandHint: this.i18n.t('chat.expandHint'),
        count: null,
      });
    }
    return list;
  });

  protected toggleRailCollapsed(): void {
    const next = !this.isRailCollapsed();
    this.isRailCollapsed.set(next);
    this.persistence.setJson(RAIL_COLLAPSED_KEY, next);
  }

  protected expand(id: CollapsiblePanelId): void {
    if (id === 'combat') this.combatPanel.setCollapsed(false);
    else this.chatPanel.setCollapsed(false);
  }
}
