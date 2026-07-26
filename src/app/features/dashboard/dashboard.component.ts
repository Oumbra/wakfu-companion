import { Component, signal } from '@angular/core';
import { DamageMeterComponent } from '../damage-meter/damage-meter.component';
import { ChatPanelComponent } from '../chat-panel/chat-panel.component';
import { TrackerComponent } from '../tracker/tracker.component';
import { TranslatePipe } from '../../shared/translate.pipe';

type DashboardTab = 'damage' | 'tracker' | 'chat';

/** En dessous du breakpoint mobile (voir dashboard.component.css), les 3
 * panneaux ne sont plus affichés en même temps mais sélectionnés via onglets
 * — chacun reste monté en permanence (juste masqué en CSS) pour conserver
 * son état (scroll, filtres...) d'un onglet à l'autre. */
@Component({
  selector: 'app-dashboard',
  imports: [DamageMeterComponent, TrackerComponent, ChatPanelComponent, TranslatePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  protected readonly activeTab = signal<DashboardTab>('damage');
}
