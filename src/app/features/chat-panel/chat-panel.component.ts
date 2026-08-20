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
import {
  ChatFilter,
  ChatFilterChannel,
  ChatPanelService,
} from '../../core/services/chat-panel.service';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';

/** Tolérance (px) pour considérer le scroll comme "tout en bas" malgré les arrondis de mise en page. */
const BOTTOM_THRESHOLD_PX = 24;

export type { ChatFilter, ChatFilterChannel };

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
  protected readonly chatPanel = inject(ChatPanelService);
  private readonly userData = inject(UserDataService);
  private readonly alertSound = inject(AlertSoundService);
  protected readonly channels = CHAT_CHANNELS;

  protected readonly activeChannels = signal<ReadonlySet<ChatChannelKey>>(
    this.loadActiveChannels(),
  );
  /** Filtres de mise en évidence/alerte : centralisés dans ChatPanelService (voir sa doc), pas
   * dupliqués ici — nécessaire pour que le badge du menu latéral (voir DashboardRailComponent)
   * reste à jour même panneau replié, où ce composant n'est plus démonté (voir
   * dashboard.component.css, repli purement CSS) mais où on ne veut pas non plus deux copies de
   * cet état qui pourraient diverger. */
  protected readonly filters = this.chatPanel.filters;
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

  /** Le nom garde "filtered" (canaux actifs, voir `toggleChannel`) même si les filtres de texte,
   * eux, ne masquent plus rien — ils ne font que mettre en évidence (voir `isHighlighted`). */
  protected readonly filteredMessages = computed(() => {
    const active = this.activeChannels();
    return this.stats.chatMessages().filter((m) => active.has(m.channel));
  });

  /** Un message est mis en évidence (dégradé + bordure, voir template/CSS) s'il correspond à l'un
   * des filtres de texte configurés — l'alerte sonore utilise le même critère (voir `effect` ci-
   * dessous), les deux doivent toujours s'accorder (voir ChatPanelService.isHighlighted). */
  protected isHighlighted(msg: ChatMessageEntry): boolean {
    return this.chatPanel.isHighlighted(msg);
  }

  private readonly chatList = viewChild<ElementRef<HTMLDivElement>>('chatList');
  /** Faux tant qu'on n'a pas encore mesuré le scroll une première fois : évite d'afficher le bouton avant le premier rendu. */
  protected readonly isAtBottom = signal(true);
  private lastMessageCount = 0;
  private lastAlertedMessageCount = 0;

  constructor() {
    // Canaux (visibilité) ont pu changer depuis un autre appareil (lot 6) — les filtres, eux,
    // sont déjà tenus à jour par ChatPanelService (`providedIn: 'root'`, jamais détruit). Ce
    // composant est monté/démonté avec sa vue, contrairement aux services `providedIn: 'root'` :
    // le désabonnement n'est pas optionnel ici.
    const destroyRef = inject(DestroyRef);
    const unsubscribeChannels = this.userData.onExternalChange('chatActiveChannels', () =>
      this.activeChannels.set(this.loadActiveChannels()),
    );
    destroyRef.onDestroy(unsubscribeChannels);

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
      if (newMessages.some((m) => this.chatPanel.isHighlighted(m))) {
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
    this.chatPanel.addFilter({ text, channel: this.newFilterChannel() });
    this.newFilterText.set('');
  }

  protected removeFilter(filter: ChatFilter): void {
    this.chatPanel.removeFilter(filter);
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
