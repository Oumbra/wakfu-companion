import { computed, inject, Injectable, signal } from '@angular/core';
import { StatsStoreService } from './stats-store.service';
import { UserDataService } from '../data-access/user-data.service';

/**
 * État du panneau Combat (desktop uniquement) : replié/déplié (synchronisable avec le compte, voir
 * UserDataService/CLAUDE.md — choix conservé indépendamment des reconnexions ET des appareils) et
 * présence d'un combat en cours (`hasActiveFight`, dérivé de `damageByAttacker`, donc jamais
 * synchronisé lui-même). Centralisé ici plutôt que recalculé séparément dans DashboardComponent et
 * dans le menu latéral des sections repliées (`DashboardRailComponent`, voir aussi son miroir
 * ChatPanelService) pour n'avoir qu'une seule source de vérité.
 *
 * `providedIn: 'root'` : jamais détruit tant que l'app tourne, donc l'abonnement
 * `onExternalChange` ci-dessous (un autre appareil replie/déplie le panneau) n'a pas besoin d'être
 * désabonné — même raisonnement que ProfileService/CharacterRosterService.
 */
@Injectable({ providedIn: 'root' })
export class CombatPanelService {
  private readonly userData = inject(UserDataService);
  private readonly stats = inject(StatsStoreService);

  readonly collapsed = signal<boolean>(
    this.userData.read<boolean>('combatPanelCollapsed') ?? false,
  );
  readonly hasActiveFight = computed(() => this.stats.damageByAttacker().length > 0);
  /** Nombre de combats en cours (multi-compte) — affiché dans le rond de notification de l'onglet replié. */
  readonly activeFightCount = computed(() => this.stats.activeFightIds().length);

  constructor() {
    this.userData.onExternalChange('combatPanelCollapsed', () =>
      this.collapsed.set(this.userData.read<boolean>('combatPanelCollapsed') ?? false),
    );
  }

  setCollapsed(value: boolean): void {
    this.collapsed.set(value);
    this.userData.write('combatPanelCollapsed', value);
  }
}
