import { computed, inject, Injectable, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';
import { StatsStoreService } from './stats-store.service';

const COMBAT_PANEL_COLLAPSED_KEY = 'wakfu-combat-panel-collapsed';

/**
 * État du panneau Combat (desktop uniquement) : replié/déplié (persisté, voir
 * CLAUDE.md — choix conservé indépendamment des reconnexions) et présence
 * d'un combat en cours (`hasActiveFight`, dérivé de `damageByAttacker`, donc
 * jamais incrémenté/persisté lui-même). Centralisé ici plutôt que recalculé
 * séparément dans DashboardComponent et dans le menu latéral des sections
 * repliées (`DashboardRailComponent`, voir aussi son miroir ChatPanelService)
 * pour n'avoir qu'une seule source de vérité.
 */
@Injectable({ providedIn: 'root' })
export class CombatPanelService {
  private readonly persistence = inject(PersistenceService);
  private readonly stats = inject(StatsStoreService);

  readonly collapsed = signal<boolean>(
    this.persistence.getJson<boolean>(COMBAT_PANEL_COLLAPSED_KEY) ?? false,
  );
  readonly hasActiveFight = computed(() => this.stats.damageByAttacker().length > 0);
  /** Nombre de combats en cours (multi-compte) — affiché dans le rond de notification de l'onglet replié. */
  readonly activeFightCount = computed(() => this.stats.activeFightIds().length);

  setCollapsed(value: boolean): void {
    this.collapsed.set(value);
    this.persistence.setJson(COMBAT_PANEL_COLLAPSED_KEY, value);
  }
}
