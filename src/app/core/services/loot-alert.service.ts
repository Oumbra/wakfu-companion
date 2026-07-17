import { Injectable, signal } from '@angular/core';

export interface LootAlertEvent {
  name: string;
  quantity: number;
}

/**
 * Relaie un évènement "objet suivi (son activé) ramassé" depuis
 * StatsStoreService vers LootAlertComponent (affichage toast + confettis +
 * son), sans coupler les deux — un nouvel objet literal à chaque trigger()
 * garantit que le signal notifie même deux ramassages successifs du même nom.
 */
@Injectable({ providedIn: 'root' })
export class LootAlertService {
  readonly current = signal<LootAlertEvent | null>(null);

  trigger(name: string, quantity: number): void {
    this.current.set({ name, quantity });
  }
}
