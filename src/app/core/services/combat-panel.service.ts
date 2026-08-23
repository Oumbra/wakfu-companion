import { computed, inject, Injectable, signal } from '@angular/core';
import { StatsStoreService } from './stats-store.service';
import { UserDataService } from '../data-access/user-data.service';

/**
 * État du bandeau "Combat en cours" affiché en tête de la liste Combats de l'Historique (voir
 * FightHistoryComponent, CLAUDE.md — fusion de l'ex-`DamageMeterComponent`, qui n'est plus une
 * carte à part du tableau de bord) : replié/déplié (synchronisable avec le compte, voir
 * UserDataService/CLAUDE.md — choix conservé indépendamment des reconnexions ET des appareils) et
 * présence d'un combat en cours (`hasActiveFight`, dérivé de `damageByAttacker`, donc jamais
 * synchronisé lui-même). Centralisé ici plutôt que recalculé séparément dans FightHistoryComponent
 * et ailleurs (badge de combat en cours) pour n'avoir qu'une seule source de vérité.
 *
 * `providedIn: 'root'` : jamais détruit tant que l'app tourne, donc l'abonnement
 * `onExternalChange` ci-dessous (un autre appareil replie/déplie le bandeau) n'a pas besoin d'être
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
