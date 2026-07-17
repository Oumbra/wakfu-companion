import { Component, inject, OnDestroy, signal } from '@angular/core';
import { StatsStoreService } from '../../core/services/stats-store.service';
import { NumberFrPipe } from '../../shared/number-fr.pipe';
import { TranslatePipe } from '../../shared/translate.pipe';
import { HEADER_ICON_SESSION_RECAP_DATA_URI } from '../../core/data/header-icons.data';

/**
 * Fenêtre flottante "Session Recap" : masquée par défaut, sans overlay de
 * fond, déplaçable par son en-tête (comme `makeDraggable` sur le site de
 * référence — pas besoin d'Angular CDK pour un simple glisser).
 */
@Component({
  selector: 'app-session-recap',
  imports: [NumberFrPipe, TranslatePipe],
  templateUrl: './session-recap.component.html',
  styleUrl: './session-recap.component.css',
})
export class SessionRecapComponent implements OnDestroy {
  protected readonly headerIcon = HEADER_ICON_SESSION_RECAP_DATA_URI;
  protected readonly stats = inject(StatsStoreService);

  protected readonly visible = signal(false);
  protected readonly duration = signal('00:00:00');
  protected readonly position = signal<{ left: number; top: number } | null>(null);

  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private dragStartMouse = { x: 0, y: 0 };
  private dragStartPos = { left: 0, top: 0 };
  private dragging = false;

  open(): void {
    this.visible.set(true);
    this.updateDuration();
    this.tickInterval ??= setInterval(() => this.updateDuration(), 1000);
  }

  close(): void {
    this.visible.set(false);
    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  toggle(): void {
    if (this.visible()) this.close();
    else this.open();
  }

  ngOnDestroy(): void {
    if (this.tickInterval !== null) clearInterval(this.tickInterval);
  }

  protected onHeaderMouseDown(event: MouseEvent, panel: HTMLElement): void {
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    this.position.set({ left: rect.left, top: rect.top });
    this.dragStartPos = { left: rect.left, top: rect.top };
    this.dragStartMouse = { x: event.clientX, y: event.clientY };
    this.dragging = true;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!this.dragging) return;
      const deltaX = moveEvent.clientX - this.dragStartMouse.x;
      const deltaY = moveEvent.clientY - this.dragStartMouse.y;
      this.position.set({
        left: this.dragStartPos.left + deltaX,
        top: this.dragStartPos.top + deltaY,
      });
    };
    const onMouseUp = () => {
      this.dragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  private updateDuration(): void {
    const startedAt = this.stats.sessionStartedAt();
    if (startedAt === null) {
      this.duration.set('00:00:00');
      return;
    }
    const elapsedMs = Date.now() - startedAt;
    const hours = Math.floor(elapsedMs / 3_600_000);
    const minutes = Math.floor((elapsedMs % 3_600_000) / 60_000);
    const seconds = Math.floor((elapsedMs % 60_000) / 1000);
    const pad = (n: number) => n.toString().padStart(2, '0');
    this.duration.set(`${pad(hours)}:${pad(minutes)}:${pad(seconds)}`);
  }
}
