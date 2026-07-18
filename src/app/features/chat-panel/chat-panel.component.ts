import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { StatsStoreService } from '../../core/services/stats-store.service';
import { PersistenceService } from '../../core/services/persistence.service';
import { CHAT_CHANNELS } from '../../core/services/log-parser';
import { ChatChannelKey } from '../../core/models/log-entry.model';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';

const ACTIVE_CHANNELS_KEY = 'wakfu-active-chat-channels';
/** Tolérance (px) pour considérer le scroll comme "tout en bas" malgré les arrondis de mise en page. */
const BOTTOM_THRESHOLD_PX = 24;

@Component({
  selector: 'app-chat-panel',
  imports: [TranslatePipe],
  templateUrl: './chat-panel.component.html',
  styleUrl: './chat-panel.component.css',
})
export class ChatPanelComponent {
  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);
  private readonly persistence = inject(PersistenceService);
  protected readonly channels = CHAT_CHANNELS;

  protected readonly activeChannels = signal<ReadonlySet<ChatChannelKey>>(
    this.loadActiveChannels(),
  );
  protected readonly filterText = signal('');

  private loadActiveChannels(): ReadonlySet<ChatChannelKey> {
    const stored = this.persistence.getJson<ChatChannelKey[]>(ACTIVE_CHANNELS_KEY);
    return new Set(stored ?? CHAT_CHANNELS.map((c) => c.key));
  }

  protected readonly filteredMessages = computed(() => {
    const active = this.activeChannels();
    const filter = this.filterText().trim().toLowerCase();
    return this.stats
      .chatMessages()
      .filter((m) => active.has(m.channel))
      .filter(
        (m) =>
          !filter ||
          m.message.toLowerCase().includes(filter) ||
          m.author.toLowerCase().includes(filter),
      );
  });

  private readonly chatList = viewChild<ElementRef<HTMLDivElement>>('chatList');
  /** Faux tant qu'on n'a pas encore mesuré le scroll une première fois : évite d'afficher le bouton avant le premier rendu. */
  protected readonly isAtBottom = signal(true);
  private lastMessageCount = 0;

  constructor() {
    effect(() => {
      const count = this.filteredMessages().length;
      const shouldStickToBottom = count > this.lastMessageCount && this.isAtBottom();
      this.lastMessageCount = count;
      if (shouldStickToBottom) {
        queueMicrotask(() => this.scrollToBottom());
      }
    });
  }

  protected onScroll(): void {
    const el = this.chatList()?.nativeElement;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.isAtBottom.set(distanceToBottom <= BOTTOM_THRESHOLD_PX);
  }

  protected scrollToBottom(): void {
    const el = this.chatList()?.nativeElement;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    this.isAtBottom.set(true);
  }

  protected toggleChannel(key: ChatChannelKey): void {
    const next = new Set(this.activeChannels());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.activeChannels.set(next);
    this.persistence.setJson(ACTIVE_CHANNELS_KEY, [...next]);
  }

  protected isActive(key: ChatChannelKey): boolean {
    return this.activeChannels().has(key);
  }

  protected setFilter(value: string): void {
    this.filterText.set(value);
  }

  protected channelBtnClass(key: ChatChannelKey): string {
    return `toggle-btn channel-btn${this.isActive(key) ? ' active' : ''}`;
  }

  protected channelColorVar(key: ChatChannelKey): string {
    return `var(--channel-${key})`;
  }

  protected channelLabelKey(key: ChatChannelKey): string {
    return `chat.channel.${key}`;
  }
}
