import { Injectable, computed, inject, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';

const STORAGE_KEY = 'wakfu-recap-period-feature-seen';

/** Version courante de la fonctionnalité "switch Session/Jour/Mois/Année + regroupement Donjon &
 * Famille/Type" de la carte Récap — incrémenter manuellement si une évolution assez notable de
 * cette fonctionnalité doit refaire apparaître le badge (même principe que
 * `PROFILE_SECTION_VERSIONS`, mais une seule fonctionnalité ici, pas une table par section). */
const CURRENT_VERSION = 1;

/**
 * Badge "NEW" (desktop, même principe que `NewSectionBadgeService` de la page profil — service
 * dédié plutôt que réutilisé tel quel : celui-ci est indexé par `ProfileTab`, une fonctionnalité
 * précise sans rapport avec la carte Récap) signalant aux utilisateurs connectés que le switch
 * Session/Jour/Mois/Année existe, tant qu'ils n'ont jamais navigué vers une période agrégée
 * (Jour/Mois/Année) — ajouté le 2026-08-28 pour donner un signal de découverte de cette
 * fonctionnalité (n'existe que pour un compte connecté, voir SessionRecapComponent).
 *
 * Purement une préférence d'affichage locale (`PersistenceService` direct, pas
 * `UserDataService`) — même raisonnement que `NewSectionBadgeService` : revoir ce badge une fois
 * de plus sur un autre appareil n'est pas gênant.
 */
@Injectable({ providedIn: 'root' })
export class RecapPeriodBadgeService {
  private readonly persistence = inject(PersistenceService);

  private readonly seenVersion = signal(this.persistence.getJson<number>(STORAGE_KEY) ?? 0);

  readonly isUnseen = computed(() => this.seenVersion() < CURRENT_VERSION);

  /** Marque la fonctionnalité comme vue à sa version courante — appelé dès que l'utilisateur
   * navigue vers une granularité Jour/Mois/Année (voir `SessionRecapComponent.setGranularity`).
   * Idempotent : n'écrit rien si déjà à jour. */
  markSeen(): void {
    if (this.seenVersion() >= CURRENT_VERSION) return;
    this.seenVersion.set(CURRENT_VERSION);
    this.persistence.setJson(STORAGE_KEY, CURRENT_VERSION);
  }
}
