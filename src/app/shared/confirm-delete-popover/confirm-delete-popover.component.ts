import {
  afterRenderEffect,
  Component,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ConfirmDeleteService } from '../../core/services/confirm-delete.service';
import { TranslatePipe } from '../translate.pipe';
import { EscapeCloseDirective } from '../escape-close.directive';

/** Marge minimale (px) entre la popover et le bord gauche de l'écran. */
const POPOVER_MARGIN = 8;

/**
 * Popover de confirmation de suppression, mutualisée entre les KPI de suivi
 * et les personnages du profil (voir ConfirmDeleteService). Navigable au
 * clavier : Tab bascule le bouton sélectionné, Entrée l'active — le focus
 * est piégé sur le conteneur plutôt que sur les boutons eux-mêmes, plus
 * simple à synchroniser avec `selectedIndex`.
 */
@Component({
  selector: 'app-confirm-delete-popover',
  imports: [TranslatePipe, EscapeCloseDirective],
  templateUrl: './confirm-delete-popover.component.html',
  styleUrl: './confirm-delete-popover.component.css',
})
export class ConfirmDeletePopoverComponent {
  private readonly confirmDelete = inject(ConfirmDeleteService);
  protected readonly request = this.confirmDelete.request;

  /** 0 = Confirmer, 1 = Annuler — Annuler sélectionné par défaut (action destructive). */
  protected readonly selectedIndex = signal<0 | 1>(1);
  private readonly popover = viewChild<ElementRef<HTMLDivElement>>('popover');
  /** Décalage vers la droite (px) quand la popover, alignée sur le bord droit de son bouton,
   * déborderait à gauche de l'écran (bouton proche du bord gauche, écran étroit) — sans lui, le
   * début de la question sortait de l'écran en mobile (ex. « Supprimer mon compte »). La flèche
   * est décalée d'autant pour rester sous le bouton. */
  protected readonly shift = signal(0);

  constructor() {
    effect(() => {
      if (!this.request()) return;
      this.selectedIndex.set(1);
      this.shift.set(0);
      this.popover()?.nativeElement.focus();
    });
    // Mesure après rendu : la largeur dépend du message, inconnue avant.
    afterRenderEffect(() => {
      const el = this.popover()?.nativeElement;
      if (!this.request() || !el || this.shift() !== 0) return;
      const overflow = POPOVER_MARGIN - el.getBoundingClientRect().left;
      if (overflow > 0) this.shift.set(overflow);
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Tab') {
      event.preventDefault();
      this.selectedIndex.update((i) => (i === 0 ? 1 : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (this.selectedIndex() === 0) this.confirm();
      else this.cancel();
    }
  }

  protected confirm(): void {
    this.request()?.onConfirm();
    this.confirmDelete.close();
  }

  protected cancel(): void {
    this.confirmDelete.close();
  }
}
