import { Component, computed, inject, signal } from '@angular/core';
import { StatsStoreService } from '../../core/services/stats-store.service';
import { CHAT_CHANNELS } from '../../core/services/log-parser';
import { ChatChannelKey } from '../../core/models/log-entry.model';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';

@Component({
  selector: 'app-chat-panel',
  imports: [TranslatePipe],
  templateUrl: './chat-panel.component.html',
  styleUrl: './chat-panel.component.css',
})
export class ChatPanelComponent {
  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);
  protected readonly channels = CHAT_CHANNELS;

  protected readonly activeChannels = signal<ReadonlySet<ChatChannelKey>>(
    new Set(CHAT_CHANNELS.map((c) => c.key)),
  );
  protected readonly filterText = signal('');

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

  protected toggleChannel(key: ChatChannelKey): void {
    const next = new Set(this.activeChannels());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.activeChannels.set(next);
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
