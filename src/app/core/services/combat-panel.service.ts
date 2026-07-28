import { computed, inject, Injectable, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';
import { StatsStoreService } from './stats-store.service';

const COMBAT_PANEL_COLLAPSED_KEY = 'wakfu-combat-panel-collapsed';

/**
 * État du panneau Combat flottant : replié/déplié (persisté, voir
 * CLAUDE.md — choix conservé indépendamment des reconnexions) et présence
 * d'un combat en cours (`hasActiveFight`, dérivé de `damageByAttacker`, donc
 * jamais incrémenté/persisté lui-même). Centralisé ici plutôt que recalculé
 * séparément dans DashboardComponent et dans le petit onglet replié monté à
 * la racine (`app.html`, voir CombatEdgeTabComponent) pour n'avoir qu'une
 * seule source de vérité.
 */
@Injectable({ providedIn: 'root' })
export class CombatPanelService {
  private readonly persistence = inject(PersistenceService);
  private readonly stats = inject(StatsStoreService);

  readonly collapsed = signal<boolean>(
    this.persistence.getJson<boolean>(COMBAT_PANEL_COLLAPSED_KEY) ?? false,
  );
  readonly hasActiveFight = computed(() => this.stats.damageByAttacker().length > 0);

  setCollapsed(value: boolean): void {
    this.collapsed.set(value);
    this.persistence.setJson(COMBAT_PANEL_COLLAPSED_KEY, value);
  }
}
