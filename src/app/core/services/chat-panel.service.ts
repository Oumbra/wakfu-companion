import { computed, inject, Injectable, signal } from '@angular/core';
import { UserDataService } from '../data-access/user-data.service';
import { StatsStoreService } from './stats-store.service';
import { ChatChannelKey, ChatMessageEntry } from '../models/log-entry.model';

/** 'global' : le filtre s'applique à tous les canaux (comportement par défaut,
 * historique). Un canal précis restreint le filtre à ce seul canal. */
export type ChatFilterChannel = ChatChannelKey | 'global';

export interface ChatFilter {
  text: string;
  channel: ChatFilterChannel;
}

/** Filtres qui s'appliquent au canal d'un message donné : les filtres
 * "global" (tous canaux) et ceux propres à ce canal. */
function applicableFilters(channel: ChatChannelKey, filters: readonly ChatFilter[]): ChatFilter[] {
  return filters.filter((f) => f.channel === 'global' || f.channel === channel);
}

function matchesFilterText(msg: ChatMessageEntry, filter: ChatFilter): boolean {
  const message = msg.message.toLowerCase();
  const author = msg.author.toLowerCase();
  return message.includes(filter.text) || author.includes(filter.text);
}

/** Un message "correspond" à un filtre s'il en existe au moins un, parmi ceux qui le ciblent
 * (global ou propre à son canal), dont le texte matche — utilisé pour la mise en évidence
 * visuelle (voir ChatPanelComponent.isHighlighted), l'alerte sonore ET le badge du menu latéral
 * quand le panneau est replié (voir ChatPanelService.matchedMessageCount) : les filtres ne
 * masquent plus aucun message, ils ne font plus que signaler une correspondance. */
function messageMatchesAnyFilter(msg: ChatMessageEntry, filters: readonly ChatFilter[]): boolean {
  return applicableFilters(msg.channel, filters).some((f) => matchesFilterText(msg, f));
}

/**
 * État du panneau Chat (desktop uniquement) : replié/déplié (synchronisable avec le compte, même
 * principe que CombatPanelService.collapsed — choix conservé indépendamment des reconnexions ET
 * des appareils, voir UserDataService). Contrairement au Combat, pas de notion d'« activité » : le
 * Chat reste repliable/dépliable à tout moment, jamais masqué tout seul. Un panneau replié rejoint
 * le menu latéral des sections repliées, voir DashboardRailComponent.
 *
 * Porte aussi les filtres de mise en évidence/alerte (voir `filters`) — centralisés ici plutôt que
 * dans ChatPanelComponent (détruit/recréé avec sa vue, contrairement à ce service `providedIn:
 * 'root'`) pour que `matchedMessageCount` reste calculable même panneau replié, et alimente le
 * badge de l'entrée "Chat" du menu latéral (voir DashboardRailComponent) sans dépendre de l'état
 * de montage du panneau lui-même.
 *
 * `providedIn: 'root'` : jamais détruit tant que l'app tourne, les abonnements
 * `onExternalChange` ci-dessous n'ont donc pas besoin d'être désabonnés — même raisonnement que
 * CombatPanelService.
 */
@Injectable({ providedIn: 'root' })
export class ChatPanelService {
  private readonly userData = inject(UserDataService);
  private readonly stats = inject(StatsStoreService);

  readonly collapsed = signal<boolean>(this.userData.read<boolean>('chatPanelCollapsed') ?? false);

  private readonly _filters = signal<ChatFilter[]>(this.loadFilters());
  readonly filters = this._filters.asReadonly();

  /** Nombre de messages de la session correspondant à au moins un filtre configuré, quel que soit
   * le canal (voir `messageMatchesAnyFilter`) — affiché en badge sur l'entrée "Chat" du menu
   * latéral une fois le panneau replié (voir DashboardRailComponent), même critère que la mise en
   * évidence/l'alerte sonore (voir ChatPanelComponent). */
  readonly matchedMessageCount = computed(
    () =>
      this.stats.chatMessages().filter((m) => messageMatchesAnyFilter(m, this._filters())).length,
  );

  constructor() {
    this.userData.onExternalChange('chatPanelCollapsed', () =>
      this.collapsed.set(this.userData.read<boolean>('chatPanelCollapsed') ?? false),
    );
    this.userData.onExternalChange('chatFilters', () => this._filters.set(this.loadFilters()));
  }

  setCollapsed(value: boolean): void {
    this.collapsed.set(value);
    this.userData.write('chatPanelCollapsed', value);
  }

  isHighlighted(msg: ChatMessageEntry): boolean {
    return messageMatchesAnyFilter(msg, this._filters());
  }

  addFilter(filter: ChatFilter): void {
    const current = this._filters();
    if (current.some((f) => f.text === filter.text && f.channel === filter.channel)) return;
    const updated = [...current, filter];
    this._filters.set(updated);
    this.userData.write('chatFilters', updated);
  }

  removeFilter(filter: ChatFilter): void {
    const updated = this._filters().filter((f) => f !== filter);
    this._filters.set(updated);
    this.userData.write('chatFilters', updated);
  }

  /** Migration douce : les filtres étaient stockés en simples chaînes avant l'ajout du choix de
   * canal — reprises telles quelles en filtres "global". */
  private loadFilters(): ChatFilter[] {
    const stored = this.userData.read<Array<string | ChatFilter>>('chatFilters') ?? [];
    return stored.map((f) => (typeof f === 'string' ? { text: f, channel: 'global' } : f));
  }
}
