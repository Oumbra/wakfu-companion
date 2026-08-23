import { Component, computed, input, output, signal } from '@angular/core';
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
 *
 * `historical()` distingue les deux appelants pour le bandeau "Informations de combat" :
 * - `true` (combat de l'historique) : la ligne de switchs devient elle-même l'en-tête repliable
 *   (label + switchs + caret sur UNE seule ligne, même principe que `.loot-header-row` — voir
 *   template/CSS), qui replie/déplie switchs ET listes alliés/ennemis ENSEMBLE (`switchesExpanded`,
 *   état LOCAL à cette instance : pas remonté dans `FightHistoryComponent`, ce composant est de
 *   toute façon détruit/recréé à chaque repli/dépli de l'entrée qui le contient).
 * - `false` (combat en cours, défaut) : PAS de bandeau/repli ici — le bandeau "Combat en cours"
 *   (voir `CombatPanelService`/`FightHistoryComponent`) masque déjà tout le bloc d'un coup quand
 *   replié, un second niveau de repli imbriqué serait un no-op fonctionnellement inutile. Les
 *   switchs restent affichés en permanence, sans label ni caret.
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
  /** Clé i18n du libellé du bouton "Cumulé" (voir DamageViewSwitchComponent) — même texte "Cumulé"
   * pour le combat en cours ET l'historique (voir CLAUDE.md, les deux disaient auparavant "Total"/
   * "Cumulé" respectivement) : 'damageMeter.viewCumulative' par défaut, l'input reste overridable
   * pour un futur appelant qui aurait besoin d'un autre libellé. */
  readonly totalLabelKey = input<string>('damageMeter.viewCumulative');
  readonly statKind = input.required<EntityStatKind>();
  readonly allyRows = input<EntityDamageRow[]>([]);
  readonly enemyRows = input<EntityDamageRow[]>([]);
  /** Combat auquel appartiennent ces lignes — voir EntityDamageListComponent.fightId. */
  readonly fightId = input<number | null>(null);
  /** Glisser-déposer actif : `true` uniquement pour le combat en cours. */
  readonly interactive = input(false);
  /** `true` pour un combat de l'historique — voir doc de tête. */
  readonly historical = input(false);
  readonly allyEmptyMessage = input.required<string>();
  readonly enemyEmptyMessage = input.required<string>();

  readonly modeChange = output<DamageViewMode>();
  readonly turnChange = output<number>();
  readonly kindChange = output<EntityStatKind>();

  /** Armure n'a pas de notion d'élément (voir EntityDamageListComponent.showElements) — dérivé
   * plutôt qu'input, les deux appelants appliquent la même règle. */
  protected readonly showElements = computed(() => this.statKind() !== 'armor');

  /** Repli du bandeau "Informations de combat" (voir doc de tête) — déplié par défaut, même
   * convention que les sous-collapses XP/butin de FightHistoryComponent. */
  protected readonly switchesExpanded = signal(true);

  protected toggleSwitches(): void {
    this.switchesExpanded.update((v) => !v);
  }
}
