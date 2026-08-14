import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { StatsStoreService } from '../../core/services/stats-store.service';
import { UserDataService } from '../../core/data-access/user-data.service';
import { AlertSoundService } from '../../core/services/alert-sound.service';
import { CHAT_CHANNELS } from '../../core/services/log-parser';
import { ChatChannelKey, ChatMessageEntry } from '../../core/models/log-entry.model';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { HelpModalService } from '../../core/services/help-modal.service';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';

/** Tolérance (px) pour considérer le scroll comme "tout en bas" malgré les arrondis de mise en page. */
const BOTTOM_THRESHOLD_PX = 24;

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
 * (global ou propre à son canal), dont le texte matche — utilisé à la fois pour la mise en
 * évidence visuelle (voir `isHighlighted`) et pour l'alerte sonore : les filtres ne masquent plus
 * aucun message (voir `filteredMessages`), ils ne font plus que signaler une correspondance. */
function messageMatchesAnyFilter(msg: ChatMessageEntry, filters: readonly ChatFilter[]): boolean {
  return applicableFilters(msg.channel, filters).some((f) => matchesFilterText(msg, f));
}

@Component({
  selector: 'app-chat-panel',
  imports: [TranslatePipe, TooltipDirective],
  templateUrl: './chat-panel.component.html',
  styleUrl: './chat-panel.component.css',
})
export class ChatPanelComponent {
  protected readonly stats = inject(StatsStoreService);
  protected readonly i18n = inject(I18nService);
  protected readonly helpModal = inject(HelpModalService);
  private readonly userData = inject(UserDataService);
  private readonly alertSound = inject(AlertSoundService);
  protected readonly channels = CHAT_CHANNELS;

  protected readonly activeChannels = signal<ReadonlySet<ChatChannelKey>>(
    this.loadActiveChannels(),
  );
  protected readonly filters = signal<ChatFilter[]>(this.loadFilters());
  protected readonly newFilterText = signal('');
  protected readonly newFilterChannel = signal<ChatFilterChannel>('global');
  /** Replié par défaut : l'entrée de filtre + le sélecteur de canal + les chips ne sont pas
   * essentiels à la lecture du chat au quotidien — les masquer par défaut sous un collapse fin
   * rend de la hauteur au fil de messages, surtout en mobile où chaque ligne compte (voir
   * CLAUDE.md). Purement local à la session (pas de persistance) : rouvrir le panneau chat doit
   * toujours repartir de cet état compact. */
  protected readonly filtersExpanded = signal(false);

  private loadActiveChannels(): ReadonlySet<ChatChannelKey> {
    const stored = this.userData.read<ChatChannelKey[]>('chatActiveChannels');
    return new Set(stored ?? CHAT_CHANNELS.map((c) => c.key));
  }

  /** Migration douce : les filtres étaient stockés en simples chaînes avant
   * l'ajout du choix de canal — reprises telles quelles en filtres "global". */
  private loadFilters(): ChatFilter[] {
    const stored = this.userData.read<Array<string | ChatFilter>>('chatFilters') ?? [];
    return stored.map((f) => (typeof f === 'string' ? { text: f, channel: 'global' } : f));
  }

  /** Le nom garde "filtered" (canaux actifs, voir `toggleChannel`) même si les filtres de texte,
   * eux, ne masquent plus rien — ils ne font que mettre en évidence (voir `isHighlighted`). */
  protected readonly filteredMessages = computed(() => {
    const active = this.activeChannels();
    return this.stats.chatMessages().filter((m) => active.has(m.channel));
  });

  /** Un message est mis en évidence (dégradé + bordure, voir template/CSS) s'il correspond à l'un
   * des filtres de texte configurés — l'alerte sonore utilise le même critère (voir `effect` ci-
   * dessous), les deux doivent toujours s'accorder. */
  protected isHighlighted(msg: ChatMessageEntry): boolean {
    return messageMatchesAnyFilter(msg, this.filters());
  }

  private readonly chatList = viewChild<ElementRef<HTMLDivElement>>('chatList');
  /** Faux tant qu'on n'a pas encore mesuré le scroll une première fois : évite d'afficher le bouton avant le premier rendu. */
  protected readonly isAtBottom = signal(true);
  private lastMessageCount = 0;
  private lastAlertedMessageCount = 0;

  constructor() {
    // Canaux et filtres ont pu changer depuis un autre appareil (lot 6). Ce
    // composant est monté/démonté avec sa vue, contrairement aux services
    // `providedIn: 'root'` : le désabonnement n'est pas optionnel ici.
    const destroyRef = inject(DestroyRef);
    const unsubscribeChannels = this.userData.onExternalChange('chatActiveChannels', () =>
      this.activeChannels.set(this.loadActiveChannels()),
    );
    const unsubscribeFilters = this.userData.onExternalChange('chatFilters', () =>
      this.filters.set(this.loadFilters()),
    );
    destroyRef.onDestroy(() => {
      unsubscribeChannels();
      unsubscribeFilters();
    });

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
      if (newMessages.some((m) => messageMatchesAnyFilter(m, filters))) {
        this.alertSound.playChatFilter();
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
    this.userData.write('chatActiveChannels', [...next]);
  }

  protected isActive(key: ChatChannelKey): boolean {
    return this.activeChannels().has(key);
  }

  protected toggleFiltersExpanded(): void {
    this.filtersExpanded.update((expanded) => !expanded);
  }

  protected setNewFilterText(value: string): void {
    this.newFilterText.set(value);
  }

  protected setNewFilterChannel(value: string): void {
    this.newFilterChannel.set(value as ChatFilterChannel);
  }

  protected addFilter(): void {
    const text = this.newFilterText().trim().toLowerCase();
    if (!text) return;
    const channel = this.newFilterChannel();
    const current = this.filters();
    if (!current.some((f) => f.text === text && f.channel === channel)) {
      const updated = [...current, { text, channel }];
      this.filters.set(updated);
      this.userData.write('chatFilters', updated);
    }
    this.newFilterText.set('');
  }

  protected removeFilter(filter: ChatFilter): void {
    const updated = this.filters().filter((f) => f !== filter);
    this.filters.set(updated);
    this.userData.write('chatFilters', updated);
  }

  protected filterChannelLabelKey(channel: ChatFilterChannel): string {
    return channel === 'global' ? 'chat.filterChannelGlobal' : this.channelLabelKey(channel);
  }

  protected channelBtnClass(key: ChatChannelKey): string {
    return `toggle-btn channel-btn${this.isActive(key) ? ' active' : ''}`;
  }

  protected channelColorVar(key: ChatChannelKey): string {
    return `var(--channel-${key})`;
  }

  /** La chip n'affiche plus le nom du canal, seulement sa couleur (voir
   * `.filter-chip` en CSS) : un filtre "global" retombe sur une couleur
   * neutre (`--text-muted`) distincte de toutes les couleurs de canal —
   * notamment de `--channel-groupe`, identique à `--accent` — pour ne pas
   * être confondu visuellement avec un filtre "Groupe". */
  protected filterChannelColorVar(channel: ChatFilterChannel): string {
    return channel === 'global' ? 'var(--text-muted)' : this.channelColorVar(channel);
  }

  protected channelLabelKey(key: ChatChannelKey): string {
    return `chat.channel.${key}`;
  }
}
