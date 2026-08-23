import { Component, computed, input, output } from '@angular/core';
import { EntityDamageRow } from '../../core/services/stats-store.service';
import { EntityDamageListComponent } from '../../features/damage-meter/entity-damage-list/entity-damage-list.component';
import { TranslatePipe } from '../translate.pipe';
import {
  DamageViewMode,
  DamageViewSwitchComponent,
} from '../damage-view-switch/damage-view-switch.component';
import {
  EntityStatKind,
  EntityStatTabsComponent,
} from '../entity-stat-tabs/entity-stat-tabs.component';

/**
 * Détail d'un combat (en cours OU historique) : ligne de switchs (Cumulé/Tour + Dommage/Armure/
 * Soin, fusionnés sur une seule ligne) puis listes alliés/ennemis — côte à côte sur desktop,
 * empilées en mobile (voir CSS). Factorise ce qui était dupliqué entre `DamageMeterComponent`
 * (combat en cours, aujourd'hui fusionné dans `FightHistoryComponent`) et le
 * `ng-template#fightEntryTpl` de `FightHistoryComponent` (un combat de l'historique) — les deux
 * points d'appel vivent désormais dans `FightHistoryComponent` (voir CLAUDE.md, "toujours un
 * composant, jamais un bloc local répété"). `[collapsible]` n'est plus proposé sur
 * `EntityDamageListComponent` en dessous : un combat historique ne se replie plus qu'à un seul
 * niveau (toute l'entrée `.fight-entry`, un seul clic — voir CLAUDE.md), plus indépendamment par
 * camp comme avant cette fusion.
 */
@Component({
  selector: 'app-combat-detail',
  imports: [
    DamageViewSwitchComponent,
    EntityStatTabsComponent,
    EntityDamageListComponent,
    TranslatePipe,
  ],
  templateUrl: './combat-detail.component.html',
  styleUrl: './combat-detail.component.css',
})
export class CombatDetailComponent {
  readonly mode = input.required<DamageViewMode>();
  readonly turn = input.required<number>();
  readonly maxTurn = input.required<number>();
  /** Clé i18n du libellé du bouton "Total" (voir DamageViewSwitchComponent) — 'damageMeter.viewTotal'
   * par défaut (combat en cours), l'historique passe 'damageMeter.viewCumulative'. */
  readonly totalLabelKey = input<string>('damageMeter.viewTotal');
  readonly statKind = input.required<EntityStatKind>();
  readonly allyRows = input<EntityDamageRow[]>([]);
  readonly enemyRows = input<EntityDamageRow[]>([]);
  /** Combat auquel appartiennent ces lignes — voir EntityDamageListComponent.fightId. */
  readonly fightId = input<number | null>(null);
  /** Glisser-déposer actif : `true` uniquement pour le combat en cours. */
  readonly interactive = input(false);
  readonly allyEmptyMessage = input.required<string>();
  readonly enemyEmptyMessage = input.required<string>();

  readonly modeChange = output<DamageViewMode>();
  readonly turnChange = output<number>();
  readonly kindChange = output<EntityStatKind>();

  /** Armure n'a pas de notion d'élément (voir EntityDamageListComponent.showElements) — dérivé
   * plutôt qu'input, les deux appelants appliquent la même règle. */
  protected readonly showElements = computed(() => this.statKind() !== 'armor');
}
