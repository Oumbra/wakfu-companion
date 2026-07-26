import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { StatsStoreService } from '../../core/services/stats-store.service';
import { PersistenceService } from '../../core/services/persistence.service';
import { AlertSoundService } from '../../core/services/alert-sound.service';
import { CHAT_CHANNELS } from '../../core/services/log-parser';
import { ChatChannelKey, ChatMessageEntry } from '../../core/models/log-entry.model';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { HEADER_ICON_CHAT_DATA_URI } from '../../core/data/header-icons.data';

const ACTIVE_CHANNELS_KEY = 'wakfu-active-chat-channels';
const CHAT_FILTERS_KEY = 'wakfu-chat-filters';
/** Tolérance (px) pour considérer le scroll comme "tout en bas" malgré les arrondis de mise en page. */
const BOTTOM_THRESHOLD_PX = 24;

function messageMatchesFilters(msg: ChatMessageEntry, filters: readonly string[]): boolean {
  if (filters.length === 0) return true;
  const message = msg.message.toLowerCase();
  const author = msg.author.toLowerCase();
  return filters.some((f) => message.includes(f) || author.includes(f));
}

@Component({
  selector: 'app-chat-panel',
  imports: [TranslatePipe],
  templateUrl: './chat-panel.component.html',
  styleUrl: './chat-panel.component.css',
})
export class ChatPanelComponent {
  protected readonly headerIcon = HEADER_ICON_CHAT_DATA_URI;
  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);
  private readonly persistence = inject(PersistenceService);
  private readonly alertSound = inject(AlertSoundService);
  protected readonly channels = CHAT_CHANNELS;

  protected readonly activeChannels = signal<ReadonlySet<ChatChannelKey>>(
    this.loadActiveChannels(),
  );
  protected readonly filters = signal<string[]>(this.loadFilters());
  protected readonly newFilterText = signal('');

  private loadActiveChannels(): ReadonlySet<ChatChannelKey> {
    const stored = this.persistence.getJson<ChatChannelKey[]>(ACTIVE_CHANNELS_KEY);
    return new Set(stored ?? CHAT_CHANNELS.map((c) => c.key));
  }

  private loadFilters(): string[] {
    return this.persistence.getJson<string[]>(CHAT_FILTERS_KEY) ?? [];
  }

  protected readonly filteredMessages = computed(() => {
    const active = this.activeChannels();
    const filters = this.filters();
    return this.stats
      .chatMessages()
      .filter((m) => active.has(m.channel))
      .filter((m) => messageMatchesFilters(m, filters));
  });

  private readonly chatList = viewChild<ElementRef<HTMLDivElement>>('chatList');
  /** Faux tant qu'on n'a pas encore mesuré le scroll une première fois : évite d'afficher le bouton avant le premier rendu. */
  protected readonly isAtBottom = signal(true);
  private lastMessageCount = 0;
  private lastAlertedMessageCount = 0;

  constructor() {
    effect(() => {
      const count = this.filteredMessages().length;
      const shouldStickToBottom = count > this.lastMessageCount && this.isAtBottom();
      this.lastMessageCount = count;
      if (shouldStickToBottom) {
        queueMicrotask(() => this.scrollToBottom());
      }
    });

    // Alerte sonore sur tout nouveau message correspondant à un filtre, même hors canaux actifs.
    // Ignore les lots d'un rechargement initial (reconnexion) : ce n'est pas du nouveau contenu.
    effect(() => {
      const messages = this.stats.chatMessages();
      const filters = this.filters();
      const previousCount = this.lastAlertedMessageCount;
      this.lastAlertedMessageCount = messages.length;
      if (filters.length === 0 || messages.length <= previousCount) return;
      if (this.stats.wasLastBatchInitialLoad()) return;
      const newMessages = messages.slice(previousCount);
      if (newMessages.some((m) => messageMatchesFilters(m, filters))) {
        this.alertSound.play();
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

  protected setNewFilterText(value: string): void {
    this.newFilterText.set(value);
  }

  protected addFilter(): void {
    const value = this.newFilterText().trim().toLowerCase();
    if (!value) return;
    const current = this.filters();
    if (!current.includes(value)) {
      const updated = [...current, value];
      this.filters.set(updated);
      this.persistence.setJson(CHAT_FILTERS_KEY, updated);
    }
    this.newFilterText.set('');
  }

  protected removeFilter(value: string): void {
    const updated = this.filters().filter((f) => f !== value);
    this.filters.set(updated);
    this.persistence.setJson(CHAT_FILTERS_KEY, updated);
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
