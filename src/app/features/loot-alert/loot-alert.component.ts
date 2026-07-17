import { Component, effect, inject, signal } from '@angular/core';
import { LootAlertService } from '../../core/services/loot-alert.service';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
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
const VISIBLE_DURATION_MS = 3500;

/**
 * Toast affiché en haut de l'écran quand un objet suivi (son activé, voir
 * ProfileService) est ramassé — jamais déclenché par une mise KO. Écoute
 * LootAlertService plutôt que StatsStoreService directement pour ne pas
 * coupler l'affichage au store de stats.
 */
@Component({
  selector: 'app-loot-alert',
  imports: [ItemIconComponent, TranslatePipe],
  templateUrl: './loot-alert.component.html',
  styleUrl: './loot-alert.component.css',
})
export class LootAlertComponent {
  private readonly lootAlertService = inject(LootAlertService);
  protected readonly i18n = inject(I18nService);

  protected readonly visible = signal(false);
  protected readonly itemName = signal('');
  protected readonly quantity = signal(1);
  protected readonly confetti = signal<ConfettiPiece[]>([]);

  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const event = this.lootAlertService.current();
      if (!event) return;
      this.show(event.name, event.quantity);
    });
  }

  private show(name: string, quantity: number): void {
    this.itemName.set(name);
    this.quantity.set(quantity);
    this.confetti.set(this.buildConfetti());
    this.visible.set(true);
    this.playChime();
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.visible.set(false), VISIBLE_DURATION_MS);
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

  /** Petit carillon généré via Web Audio (pas de fichier audio à embarquer/servir). */
  private playChime(): void {
    try {
      const AudioCtx =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      const notes = [880, 1318.51];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = ctx.currentTime + i * 0.11;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.4);
      });
      setTimeout(() => void ctx.close(), 900);
    } catch {
      // Web Audio indisponible : l'alerte visuelle reste affichée sans son.
    }
  }
}
