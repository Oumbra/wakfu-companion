import { Injectable, signal } from '@angular/core';

/**
 * Pilote la fenêtre flottante "Session Recap" (SessionRecapComponent, rendue une seule fois au
 * niveau racine — voir app.html) : un simple signal ouvert/fermé, même principe que
 * HelpModalService/ClassPickerService. Nécessaire pour que des boutons situés dans des
 * sous-arbres distincts (header principal, AppHeaderComponent des pages secondaires) puissent
 * tous les deux basculer le même panneau sans référence de template partagée.
 */
@Injectable({ providedIn: 'root' })
export class SessionRecapService {
  readonly isOpen = signal(false);

  open(): void {
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  toggle(): void {
    this.isOpen.update((v) => !v);
  }
}
