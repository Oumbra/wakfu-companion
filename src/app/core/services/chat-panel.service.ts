import { inject, Injectable, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';

const CHAT_PANEL_COLLAPSED_KEY = 'wakfu-chat-panel-collapsed';

/**
 * État du panneau Chat (desktop uniquement) : replié/déplié (persisté, même
 * principe que CombatPanelService.collapsed — choix conservé indépendamment
 * des reconnexions). Contrairement au Combat, pas de notion d'« activité » :
 * le Chat reste repliable/dépliable à tout moment, jamais masqué tout seul.
 * Un panneau replié rejoint le menu latéral des sections repliées, voir
 * DashboardRailComponent.
 */
@Injectable({ providedIn: 'root' })
export class ChatPanelService {
  private readonly persistence = inject(PersistenceService);

  readonly collapsed = signal<boolean>(
    this.persistence.getJson<boolean>(CHAT_PANEL_COLLAPSED_KEY) ?? false,
  );

  setCollapsed(value: boolean): void {
    this.collapsed.set(value);
    this.persistence.setJson(CHAT_PANEL_COLLAPSED_KEY, value);
  }
}
