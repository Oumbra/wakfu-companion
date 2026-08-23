import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { CombatPanelService } from '../../core/services/combat-panel.service';
import { ChatPanelService } from '../../core/services/chat-panel.service';
import { UserDataService } from '../../core/data-access/user-data.service';
import { I18nService } from '../../core/services/i18n.service';
import { DashboardLayoutService } from '../../core/services/dashboard-layout.service';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { IconComponent } from '../../shared/icon/icon.component';

type CollapsiblePanelId = 'combat' | 'chat';

interface RailEntry {
  id: CollapsiblePanelId;
  label: string;
  /** Toujours affiché en tooltip (contrairement à `.profile-rail-btn`, dont le tooltip
   * n'apparaît que rail replié — voir template) : contrairement à un simple changement d'onglet,
   * cliquer une entrée ici agrandit le panneau correspondant, une action qui vaut la peine d'être
   * rappelée même quand le libellé est déjà visible (rail déplié). */
  expandHint: string;
  /** Badge affiché sur l'entrée, `null` pour le masquer entièrement — nombre de combats en cours
   * (multi-compte, jamais `null` : l'entrée Combat n'existe elle-même que pendant un combat en
   * cours, toujours ≥ 1) pour Combat ; nombre de messages correspondant aux filtres configurés
   * pour Chat (voir ChatPanelService.matchedMessageCount), `null` tant qu'il vaut 0 — un vrai
   * badge DE NOTIFICATION n'a rien à signaler dans ce cas, contrairement à Combat. */
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
 * : n'occupe RIEN dans le flex `:host` de `DashboardComponent` (voir dashboard.component.css) tant
 * qu'aucune section n'est repliée, plutôt qu'un rail vide qui gaspillerait de la largeur. Rendu
 * comme SIBLING de `.dashboard` (pas imbriqué dedans) pour toucher le bord gauche de l'écran,
 * exactement comme `.profile-rail` touche celui de la page profil.
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
    // Contrairement à CombatPanelService/ChatPanelService (`providedIn: 'root'`, jamais détruits),
    // ce composant est démonté/remonté avec DashboardComponent (voir app.html, `@if (status ===
    // 'connected')`) : désabonnement nécessaire, même principe que ChatPanelComponent.
    const destroyRef = inject(DestroyRef);
    const unsubscribe = this.userData.onExternalChange('dashboardRailCollapsed', () =>
      this.isRailCollapsed.set(this.userData.read<boolean>('dashboardRailCollapsed') ?? false),
    );
    destroyRef.onDestroy(unsubscribe);
  }

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
        // `null` (badge masqué, voir template) plutôt que `0` : un vrai badge DE NOTIFICATION
        // n'a rien à signaler tant qu'aucun message ne correspond à un filtre — contrairement au
        // compteur de combats de Combat ci-dessus, jamais 0 en pratique (l'entrée n'existe que
        // pendant un combat en cours, toujours au moins 1).
        count: this.chatPanel.matchedMessageCount() || null,
      });
    }
    return list;
  });

  protected toggleRailCollapsed(): void {
    const next = !this.isRailCollapsed();
    this.isRailCollapsed.set(next);
    this.userData.write('dashboardRailCollapsed', next);
  }

  protected expand(id: CollapsiblePanelId): void {
    if (id === 'combat') this.combatPanel.setCollapsed(false);
    else this.chatPanel.setCollapsed(false);
  }
}
