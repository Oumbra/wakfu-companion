import { inject, Injectable, signal } from '@angular/core';
import { UserDataService } from '../data-access/user-data.service';

/**
 * État du panneau Chat (desktop uniquement) : replié/déplié (synchronisable avec le compte, même
 * principe que CombatPanelService.collapsed — choix conservé indépendamment des reconnexions ET
 * des appareils, voir UserDataService). Contrairement au Combat, pas de notion d'« activité » : le
 * Chat reste repliable/dépliable à tout moment, jamais masqué tout seul. Un panneau replié rejoint
 * le menu latéral des sections repliées, voir DashboardRailComponent.
 *
 * `providedIn: 'root'` : jamais détruit tant que l'app tourne, l'abonnement `onExternalChange`
 * ci-dessous n'a donc pas besoin d'être désabonné — même raisonnement que CombatPanelService.
 */
@Injectable({ providedIn: 'root' })
export class ChatPanelService {
  private readonly userData = inject(UserDataService);

  readonly collapsed = signal<boolean>(this.userData.read<boolean>('chatPanelCollapsed') ?? false);

  constructor() {
    this.userData.onExternalChange('chatPanelCollapsed', () =>
      this.collapsed.set(this.userData.read<boolean>('chatPanelCollapsed') ?? false),
    );
  }

  setCollapsed(value: boolean): void {
    this.collapsed.set(value);
    this.userData.write('chatPanelCollapsed', value);
  }
}
