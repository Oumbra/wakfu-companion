import { Injectable, signal } from '@angular/core';

export interface LootAlertEvent {
  name: string;
  quantity: number;
  /** 'item' (défaut) affiche l'icône objet ; 'enemy' l'icône monstre — voir
   * WatchlistKind (StatsStoreService), réutilisé tel quel pour l'alerte de décompte. */
  kind: 'item' | 'enemy';
  /** 'loot' (défaut) : ramassage d'un objet suivi (son activé, voir ProfileService). 'countdown' :
   * un compteur de suivi (objet ou monstre) vient d'atteindre 0 — voir StatsStoreService.incrementWatched. */
  reason: 'loot' | 'countdown';
  /** Id Ankama de l'objet/monstre, quand connu (voir WatchlistEntry.catalogId/SoundItemEntry.catalogId)
   * — résolution non ambiguë de l'icône affichée en cas d'homonymes. `null` si jamais capturé. */
  id: number | null;
}

/**
 * Relaie un évènement d'alerte (ramassage d'objet suivi avec son activé, ou
 * compteur de suivi tombé à zéro) depuis StatsStoreService vers
 * LootAlertComponent (affichage toast + confettis + son), sans coupler les
 * deux — un nouvel objet literal à chaque trigger() garantit que le signal
 * notifie même deux déclenchements successifs du même nom.
 */
@Injectable({ providedIn: 'root' })
export class LootAlertService {
  readonly current = signal<LootAlertEvent | null>(null);

  trigger(
    name: string,
    quantity: number,
    options?: { kind?: 'item' | 'enemy'; reason?: 'loot' | 'countdown'; id?: number | null },
  ): void {
    this.current.set({
      name,
      quantity,
      kind: options?.kind ?? 'item',
      reason: options?.reason ?? 'loot',
      id: options?.id ?? null,
    });
  }
}
