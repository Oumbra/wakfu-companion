import { Component, computed, inject } from '@angular/core';
import { EntityDamageRow, StatsStoreService } from '../../core/services/stats-store.service';
import { EntityClassifierService } from '../../core/services/entity-classifier.service';
import { CombatPanelService } from '../../core/services/combat-panel.service';
import { EntityDamageListComponent } from './entity-damage-list/entity-damage-list.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { HEADER_ICON_COMBAT_DATA_URI } from '../../core/data/header-icons.data';
import { HelpModalService } from '../../core/services/help-modal.service';

/**
 * Combat en cours uniquement — l'historique des combats a été extrait vers
 * FightHistoryComponent (sous-onglet "Combats" de la nouvelle section
 * Historique, voir HistoryComponent). Ce panneau n'est monté par
 * DashboardComponent que lorsqu'un combat est en cours (voir
 * CombatPanelService.hasActiveFight) et peut être replié en un petit onglet
 * flottant (bouton ci-dessous, voir CombatEdgeTabComponent).
 */
@Component({
  selector: 'app-damage-meter',
  imports: [EntityDamageListComponent, TranslatePipe],
  templateUrl: './damage-meter.component.html',
  styleUrl: './damage-meter.component.css',
})
export class DamageMeterComponent {
  protected readonly headerIcon = HEADER_ICON_COMBAT_DATA_URI;

  private readonly stats = inject(StatsStoreService);
  private readonly classifier = inject(EntityClassifierService);
  protected readonly combatPanel = inject(CombatPanelService);
  protected readonly i18n = inject(I18nService);
  protected readonly helpModal = inject(HelpModalService);

  protected readonly allyRows = computed<EntityDamageRow[]>(() =>
    this.stats.damageByAttacker().filter((r) => this.classifier.classify(r.name) === 'ally'),
  );
  protected readonly enemyRows = computed<EntityDamageRow[]>(() =>
    this.stats.damageByAttacker().filter((r) => this.classifier.classify(r.name) === 'enemy'),
  );
  protected readonly hasCurrentFight = computed(
    () => this.allyRows().length > 0 || this.enemyRows().length > 0,
  );

  protected readonly currentFightTurns = this.stats.currentFightTurns;
  protected readonly currentFightDurationMs = this.stats.currentFightDurationMs;
  /** Plusieurs combats concurrents (multi-compte) : un onglet par combat, affiché au-dessus du nombre de tours. */
  protected readonly activeFightIds = this.stats.activeFightIds;
  protected readonly displayedFightId = this.stats.displayedFightId;

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
