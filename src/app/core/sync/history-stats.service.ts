import { Injectable, inject, signal } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';

/** Totaux d'un groupe de combats (un donjon, ou une famille de monstre) — voir `PeriodStats.
 * dungeons`/`families`. Contrairement aux sections globales (XP/Kamas/Butin de toute la période),
 * `xpByCharacter`/`loot` sont ici propres à CE groupe (déjà filtrés côté serveur), pas recalculés
 * côté client. */
export interface PeriodGroupTotals {
  fights: number;
  /** Nombre de "donjons" (regroupement de combats, PAS un décompte de combats) — voir
   * `functions/api/v1/history/stats.ts` pour le calcul et son approximation acceptée. Toujours 0
   * pour un groupe `families` (hors donjon) : le concept ne s'y applique pas, `SessionRecapComponent`
   * retombe alors sur `fights`. */
  dungeonRuns: number;
  /** Pour un groupe donjon (`PeriodStats.dungeons`) : issue du combat de BOSS uniquement (voir
   * `functions/api/v1/history/stats.ts`) — PAS l'ensemble des combats du donjon (les salles,
   * presque toujours gagnées avant de progresser, n'y comptent pas). Pour un groupe famille
   * (`PeriodStats.families`) : combats bruts, aucune notion de boss hors donjon. */
  won: number;
  lost: number;
  kamasGained: number;
  xpGained: number;
  xpByCharacter: { name: string; amount: number }[];
  loot: { itemId: number | null; itemName: string | null; quantity: number }[];
}

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
  /** Regroupement des combats de la période par donjon (`dungeonId` = id Ankama, TOUJOURS non-null
   * ici — le hors-donjon part dans `families` ci-dessous) — voir `SessionRecapComponent`/
   * `CatalogService.findWakfuDungeonEntryById` pour la résolution du nom localisé, jamais faite
   * côté serveur. Non trié côté client : le composant retrie selon le mode d'affichage actif. */
  dungeons: (PeriodGroupTotals & { dungeonId: number })[];
  /** Regroupement des combats HORS DONJON de la période par famille de monstre représentative
   * (`familyId` = id `CatalogMonsterFamilyEntry`, `null` = famille inconnue/monstre non catalogué,
   * voir `functions/api/v1/history/stats.ts` pour comment cette famille est déterminée). */
  families: (PeriodGroupTotals & { familyId: number | null })[];
  /** Extractions de pacte de la période (voir CLAUDE.md, feature "Pacte") — jamais rattachées à un
   * combat précis, donc pas de regroupement par donjon/famille comme `loot` ci-dessus. */
  pacts: { itemId: number | null; itemName: string | null; quantity: number }[];
}

/**
 * Agrégation par période (switch Session/Jour/Mois/Année + navigation vers une période passée de
 * la carte Récap). Un seul résultat "actif" à la fois (`stats`, ce que le composant affiche), plus
 * un cache mémoire des PÉRIODES PASSÉES déjà chargées (voir `load`, paramètre `cacheKey`) — jamais
 * la période EN COURS (offset 0 dans `SessionRecapComponent`), qui reste par nature toujours
 * susceptible de changer tant qu'elle n'est pas terminée et doit donc toujours être rechargée
 * depuis le serveur. Un passé déjà écoulé, lui, ne change plus (hors correction manuelle d'objet,
 * cas limite ignoré ici) : le rejouer depuis le cache évite une requête réseau à chaque aller-retour
 * dans le stepper de périodes. Vidé à la déconnexion (`reset()`).
 *
 * Ne connaît PAS la granularité elle-même ('jour'/'mois'/'année') ni comment calculer ses bornes
 * (voir `core/utils/local-period.util.ts`) — ce service se contente de demander l'agrégat entre
 * deux instants déjà résolus par l'appelant (`SessionRecapComponent`).
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

  /** Cache des périodes PASSÉES (voir doc de classe) — pas de limite de taille : le nombre de clés
   * réellement visitées dans une session (granularité × pas de stepper effectivement parcourus)
   * reste négligeable. */
  private readonly cache = new Map<string, PeriodStats>();

  /** Incrémenté à chaque appel — sert à ignorer une réponse réseau arrivée après une plus récente
   * (navigation rapide dans le stepper de périodes) : sans ça, une réponse lente pourrait écraser
   * après coup le résultat d'un clic plus récent déjà affiché. */
  private requestSeq = 0;

  /** `cacheKey`, quand fourni, identifie une période PASSÉE réutilisable (voir doc de classe) —
   * omis pour la période en cours, toujours rechargée. */
  async load(since: Date, until: Date, cacheKey?: string): Promise<void> {
    const cached = cacheKey ? this.cache.get(cacheKey) : undefined;
    if (cached) {
      this._stats.set(cached);
      this._failed.set(false);
      this._loading.set(false);
      return;
    }

    const requestId = ++this.requestSeq;
    this._loading.set(true);
    const query = `?since=${encodeURIComponent(since.toISOString())}&until=${encodeURIComponent(until.toISOString())}`;
    const result = await this.api.getJson<PeriodStats>(`/history/stats${query}`, { retries: 0 });
    // Une requête plus récente a pris le relais entre-temps (navigation rapide) : cette réponse est
    // périmée, ne surtout pas écraser ce qui est déjà affiché avec elle.
    if (requestId !== this.requestSeq) return;
    this._loading.set(false);

    if (!result.ok) {
      this._failed.set(true);
      return;
    }
    this._failed.set(false);
    this._stats.set(result.data);
    if (cacheKey) this.cache.set(cacheKey, result.data);
  }

  /** Repart de zéro (déconnexion) — même principe que `HistoryArchiveService.reset`. */
  reset(): void {
    this._stats.set(null);
    this._loading.set(false);
    this._failed.set(false);
    this.cache.clear();
  }
}
