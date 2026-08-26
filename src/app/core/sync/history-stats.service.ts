import { Injectable, inject, signal } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';

/** Miroir exact de la réponse `GET /api/v1/history/stats?since=&until=` (voir
 * `functions/api/v1/history/stats.ts`) — agrégats SQL, jamais recalculés côté client. */
export interface PeriodStats {
  since: string;
  until: string;
  combats: {
    won: number;
    lost: number;
    challengesPassed: number;
    challengesFailed: number;
  };
  kamas: {
    fromCombat: number;
    fromHdvSales: number;
    spentOnPurchases: number;
    tradesAcquired: number;
    tradesGiven: number;
    tradeCount: number;
  };
  xpByCharacter: { name: string; amount: number }[];
  loot: { itemId: number | null; itemName: string | null; quantity: number }[];
}

/**
 * Agrégation par période (switch Session/Jour/Mois/Année de la carte Récap) — un seul résultat en
 * mémoire à la fois, rechargé à chaque changement de granularité (pas de cache multi-période : la
 * requête serveur est déjà agrégée et rapide, une mise en cache multi-clé serait une optimisation
 * prématurée pour cette itération). Ne connaît PAS la granularité elle-même ('jour'/'mois'/'année')
 * ni comment calculer ses bornes (voir `core/utils/local-period.util.ts`) — ce service se contente
 * de demander l'agrégat entre deux instants déjà résolus par l'appelant (`SessionRecapComponent`).
 *
 * N'a de sens que pour un compte connecté (voir `AuthService`) : appelé uniquement depuis un
 * contexte déjà su authentifié, jamais spontanément.
 */
@Injectable({ providedIn: 'root' })
export class HistoryStatsService {
  private readonly api = inject(ApiClientService);

  private readonly _stats = signal<PeriodStats | null>(null);
  private readonly _loading = signal(false);
  private readonly _failed = signal(false);

  readonly stats = this._stats.asReadonly();
  readonly loading = this._loading.asReadonly();
  /** Vrai quand la dernière lecture a échoué (hors ligne, serveur indisponible, session expirée
   * entre-temps) — un 401 est déjà traité globalement (retour en mode invité) par `ApiClientService`. */
  readonly failed = this._failed.asReadonly();

  async load(since: Date, until: Date): Promise<void> {
    this._loading.set(true);
    const query = `?since=${encodeURIComponent(since.toISOString())}&until=${encodeURIComponent(until.toISOString())}`;
    const result = await this.api.getJson<PeriodStats>(`/history/stats${query}`, { retries: 0 });
    this._loading.set(false);

    if (!result.ok) {
      this._failed.set(true);
      return;
    }
    this._failed.set(false);
    this._stats.set(result.data);
  }

  /** Repart de zéro (déconnexion) — même principe que `HistoryArchiveService.reset`. */
  reset(): void {
    this._stats.set(null);
    this._loading.set(false);
    this._failed.set(false);
  }
}
