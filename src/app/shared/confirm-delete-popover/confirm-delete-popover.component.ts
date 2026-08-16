import { Component, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { ConfirmDeleteService } from '../../core/services/confirm-delete.service';
import { TranslatePipe } from '../translate.pipe';
import { EscapeCloseDirective } from '../escape-close.directive';

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

  constructor() {
    effect(() => {
      if (!this.request()) return;
      this.selectedIndex.set(1);
      this.popover()?.nativeElement.focus();
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
