import { Component, computed, effect, inject, signal } from '@angular/core';
import { EntityDamageRow, StatsStoreService } from '../../core/services/stats-store.service';
import { EntityClassifierService } from '../../core/services/entity-classifier.service';
import { CombatPanelService } from '../../core/services/combat-panel.service';
import { EntityDamageListComponent } from './entity-damage-list/entity-damage-list.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { HelpModalService } from '../../core/services/help-modal.service';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { IconComponent } from '../../shared/icon/icon.component';
import {
  DamageViewMode,
  DamageViewSwitchComponent,
} from '../../shared/damage-view-switch/damage-view-switch.component';
import {
  EntityStatKind,
  EntityStatTabsComponent,
} from '../../shared/entity-stat-tabs/entity-stat-tabs.component';

/**
 * Combat en cours uniquement — l'historique des combats a été extrait vers
 * FightHistoryComponent (sous-onglet "Combats" de la nouvelle section
 * Historique, voir HistoryComponent). Ce panneau n'est monté par
 * DashboardComponent que lorsqu'un combat est en cours (voir
 * CombatPanelService.hasActiveFight) et peut être replié (bouton ci-dessous,
 * desktop uniquement) vers le menu latéral des sections repliées, voir
 * DashboardRailComponent.
 */
@Component({
  selector: 'app-damage-meter',
  imports: [
    EntityDamageListComponent,
    TranslatePipe,
    TooltipDirective,
    DamageViewSwitchComponent,
    EntityStatTabsComponent,
    IconComponent,
  ],
  templateUrl: './damage-meter.component.html',
  styleUrl: './damage-meter.component.css',
})
export class DamageMeterComponent {
  private readonly stats = inject(StatsStoreService);
  private readonly classifier = inject(EntityClassifierService);
  protected readonly combatPanel = inject(CombatPanelService);
  protected readonly i18n = inject(I18nService);
  protected readonly helpModal = inject(HelpModalService);

  /** Statistique affichée par les listes alliés/ennemis (voir EntityStatTabsComponent) — repart à
   * 'damage' à chaque changement de combat affiché, comme `viewMode` ci-dessous. */
  protected readonly statKind = signal<EntityStatKind>('damage');

  private readonly statRowsByKind: Record<EntityStatKind, () => EntityDamageRow[]> = {
    damage: () => this.stats.damageByAttacker(),
    armor: () => this.stats.armorByAttacker(),
    heal: () => this.stats.healByAttacker(),
  };

  /** Lignes de la statistique actuellement sélectionnée — `hasCurrentFight` reste volontairement
   * basé sur les dégâts (ci-dessous), pas sur cette statistique : un combat démarré sans encore
   * aucun soin/armure donné ne doit pas masquer l'en-tête tours/durée ni les onglets eux-mêmes. */
  private readonly currentStatRows = computed<EntityDamageRow[]>(() =>
    this.statRowsByKind[this.statKind()](),
  );
  protected readonly allyRows = computed<EntityDamageRow[]>(() =>
    this.currentStatRows().filter((r) => this.classifier.classify(r.name) === 'ally'),
  );
  protected readonly enemyRows = computed<EntityDamageRow[]>(() =>
    this.currentStatRows().filter((r) => this.classifier.classify(r.name) === 'enemy'),
  );
  protected readonly hasCurrentFight = computed(() => this.stats.damageByAttacker().length > 0);

  protected readonly currentFightTurns = this.stats.currentFightTurns;
  protected readonly currentFightDurationMs = this.stats.currentFightDurationMs;
  /** Plusieurs combats concurrents (multi-compte) : un onglet par combat, affiché au-dessus du nombre de tours. */
  protected readonly activeFightIds = this.stats.activeFightIds;
  protected readonly displayedFightId = this.stats.displayedFightId;

  /** Switch Total/Tour (voir DamageViewSwitchComponent) — un seul état pour tout le panneau,
   * partagé entre alliés et ennemis (même combat, même tour). Repart à 'total' à chaque
   * changement de combat affiché (onglet ou fin de combat) : un tour choisi pour un combat n'a
   * aucun sens pour un autre. */
  protected readonly viewMode = signal<DamageViewMode>('total');
  /** Tour sélectionné explicitement par l'utilisateur (pas à pas) — `null` = suit automatiquement
   * le tour courant du combat (comportement par défaut, voir `effectiveTurn`), même principe que
   * `StatsStoreService.selectedFightId`/`displayedFightId` (suivi automatique tant qu'aucun choix
   * explicite n'a été fait). */
  private readonly selectedTurn = signal<number | null>(null);
  protected readonly effectiveTurn = computed(() =>
    Math.min(this.selectedTurn() ?? this.currentFightTurns(), this.currentFightTurns()),
  );

  constructor() {
    // Changer de combat affiché (onglet multi-compte, ou fin du combat courant révélant le
    // suivant) invalide toute sélection de tour précédente : revenir au suivi automatique plutôt
    // que de garder un numéro de tour qui ne correspond plus au même combat.
    effect(() => {
      this.displayedFightId();
      this.selectedTurn.set(null);
      this.viewMode.set('total');
      this.statKind.set('damage');
    });
  }

  protected setViewMode(mode: DamageViewMode): void {
    this.viewMode.set(mode);
  }

  protected setStatKind(kind: EntityStatKind): void {
    this.statKind.set(kind);
  }

  /** Clé i18n du message vide, déclinée par statistique affichée (voir EntityStatTabsComponent) —
   * `side` distingue alliés/ennemis, comme les clés historiques `emptyAllies`/`emptyEnemies`. */
  protected emptyMessageKey(side: 'ally' | 'enemy'): string {
    const suffix =
      this.statKind() === 'damage' ? '' : this.statKind() === 'armor' ? 'Armor' : 'Heal';
    return side === 'ally'
      ? `damageMeter.emptyAllies${suffix}`
      : `damageMeter.emptyEnemies${suffix}`;
  }

  protected setTurn(turn: number): void {
    this.selectedTurn.set(turn);
  }

  protected formatDuration(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes} ${this.i18n.t('damageMeter.minutes')} ${seconds}${this.i18n.t('damageMeter.seconds')}`;
  }

  protected tabLabel(index: number): string {
    return this.i18n.t('damageMeter.combatTab', { n: index + 1 });
  }

  protected selectFight(fightId: number): void {
    this.stats.selectDisplayedFight(fightId);
  }
}
