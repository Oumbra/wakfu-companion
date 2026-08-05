import { Component, effect, inject, signal } from '@angular/core';
import { LootAlertService } from '../../core/services/loot-alert.service';
import { ProfileService } from '../../core/services/profile.service';
import { AlertSoundService } from '../../core/services/alert-sound.service';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { EntityIconComponent } from '../../shared/entity-icon/entity-icon.component';
import { I18nService } from '../../core/services/i18n.service';
import { TranslatePipe } from '../../shared/translate.pipe';

interface ConfettiPiece {
  left: string;
  delay: string;
  duration: string;
  rotate: string;
  color: string;
}

const CONFETTI_COLORS = [
  '#ffb703',
  '#fb8500',
  '#219ebc',
  '#8ecae6',
  '#ff006e',
  '#8338ec',
  '#3a86ff',
  '#06d6a0',
];
const CONFETTI_PIECE_COUNT = 28;

/**
 * Toast affiché en haut de l'écran quand un objet suivi (son activé, voir
 * ProfileService) est ramassé — jamais déclenché par une mise KO. Écoute
 * LootAlertService plutôt que StatsStoreService directement pour ne pas
 * coupler l'affichage au store de stats.
 */
@Component({
  selector: 'app-loot-alert',
  imports: [ItemIconComponent, EntityIconComponent, TranslatePipe],
  templateUrl: './loot-alert.component.html',
  styleUrl: './loot-alert.component.css',
})
export class LootAlertComponent {
  private readonly lootAlertService = inject(LootAlertService);
  private readonly profile = inject(ProfileService);
  private readonly alertSound = inject(AlertSoundService);
  protected readonly i18n = inject(I18nService);

  protected readonly visible = signal(false);
  protected readonly itemName = signal('');
  protected readonly quantity = signal(1);
  protected readonly kind = signal<'item' | 'enemy'>('item');
  protected readonly reason = signal<'loot' | 'countdown'>('loot');
  protected readonly confetti = signal<ConfettiPiece[]>([]);

  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const event = this.lootAlertService.current();
      if (!event) return;
      this.show(event.name, event.quantity, event.kind, event.reason);
    });
  }

  private show(
    name: string,
    quantity: number,
    kind: 'item' | 'enemy',
    reason: 'loot' | 'countdown',
  ): void {
    this.itemName.set(name);
    this.quantity.set(quantity);
    this.kind.set(kind);
    this.reason.set(reason);
    this.confetti.set(this.buildConfetti());
    this.visible.set(true);
    if (reason === 'countdown') this.alertSound.playCountdown();
    else this.alertSound.playLoot();
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    // Fermeture manuelle (voir close()) : pas de minuterie du tout.
    if (!this.profile.alertManualClose()) {
      const durationSeconds = this.profile.alertDurationSeconds();
      this.hideTimer = setTimeout(() => this.visible.set(false), durationSeconds * 1000);
    }
  }

  protected close(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.visible.set(false);
  }

  private buildConfetti(): ConfettiPiece[] {
    return Array.from({ length: CONFETTI_PIECE_COUNT }, () => ({
      left: `${Math.random() * 100}%`,
      delay: `${(Math.random() * 0.3).toFixed(2)}s`,
      duration: `${(1.1 + Math.random() * 0.8).toFixed(2)}s`,
      rotate: `${Math.round(Math.random() * 360)}deg`,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    }));
  }
}
