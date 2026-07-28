import { Component, computed, signal } from '@angular/core';
import { DamageMeterComponent } from '../damage-meter/damage-meter.component';
import { ChatPanelComponent } from '../chat-panel/chat-panel.component';
import { TrackerComponent } from '../tracker/tracker.component';
import { PurchasesComponent } from '../purchases/purchases.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import {
  HEADER_ICON_CHAT_DATA_URI,
  HEADER_ICON_COMBAT_DATA_URI,
  HEADER_ICON_SUIVI_DATA_URI,
} from '../../core/data/header-icons.data';

type DashboardTab = 'damage' | 'tracker' | 'purchases' | 'chat';

/** En dessous du breakpoint mobile (voir dashboard.component.css), les 4
 * panneaux ne sont plus affichés en même temps mais sélectionnés via onglets
 * — chacun reste monté en permanence (juste masqué en CSS) pour conserver
 * son état (scroll, filtres...) d'un onglet à l'autre. */
@Component({
  selector: 'app-dashboard',
  imports: [
    DamageMeterComponent,
    TrackerComponent,
    PurchasesComponent,
    ChatPanelComponent,
    TranslatePipe,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  protected readonly activeTab = signal<DashboardTab>('damage');
  protected readonly combatIcon = HEADER_ICON_COMBAT_DATA_URI;
  protected readonly suiviIcon = HEADER_ICON_SUIVI_DATA_URI;
  protected readonly chatIcon = HEADER_ICON_CHAT_DATA_URI;

  private static readonly TAB_ORDER: readonly DashboardTab[] = [
    'damage',
    'tracker',
    'purchases',
    'chat',
  ];
  /** Index de l'onglet actif (voir `.tab-slider` en CSS, qui glisse selon cet index). */
  protected readonly activeTabIndex = computed(() =>
    DashboardComponent.TAB_ORDER.indexOf(this.activeTab()),
  );
}
