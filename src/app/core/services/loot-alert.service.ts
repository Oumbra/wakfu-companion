import { Injectable, signal } from '@angular/core';

export type LootAlertReason = 'loot' | 'countdown' | 'goal';

export interface LootAlertEvent {
  name: string;
  quantity: number;
  /** 'item' (défaut) affiche l'icône objet ; 'enemy' l'icône monstre — voir
   * WatchlistKind (StatsStoreService), réutilisé tel quel pour l'alerte de décompte. */
  kind: 'item' | 'enemy';
  /** 'loot' (défaut) : ramassage d'un objet de la liste d'alertes (voir ProfileService). 'countdown' :
   * un compteur de suivi (objet ou monstre) vient d'atteindre 0. 'goal' : un compteur de suivi en
   * mode objectif vient d'atteindre sa cible — voir StatsStoreService.incrementWatched. */
  reason: LootAlertReason;
  /** Id Ankama de l'objet/monstre, quand connu (voir WatchlistEntry.catalogId/SoundItemEntry.catalogId)
   * — résolution non ambiguë de l'icône affichée en cas d'homonymes. `null` si jamais capturé. */
  id: number | null;
  /** Son coupé pour cet objet (haut-parleur barré, voir SoundItemEntry.enabled) : message et
   * confettis s'affichent quand même, seul le son est omis. */
  muted: boolean;
}

/**
 * Relaie un évènement d'alerte (ramassage d'un objet de la liste d'alertes,
 * compteur de suivi tombé à zéro ou objectif atteint) depuis StatsStoreService vers
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
    options?: {
      kind?: 'item' | 'enemy';
      reason?: LootAlertReason;
      id?: number | null;
      muted?: boolean;
    },
  ): void {
    this.current.set({
      name,
      quantity,
      kind: options?.kind ?? 'item',
      reason: options?.reason ?? 'loot',
      id: options?.id ?? null,
      muted: options?.muted ?? false,
    });
  }
}
