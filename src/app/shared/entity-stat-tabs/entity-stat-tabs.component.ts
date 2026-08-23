import { Component, input, output } from '@angular/core';
import { TranslatePipe } from '../translate.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';

export type EntityStatKind = 'damage' | 'armor' | 'heal';

/** Icônes wakassets (voir CLAUDE.md) des 3 statistiques suivies par entité. */
const STAT_ICON_URLS: Record<EntityStatKind, string> = {
  damage: 'https://vertylo.github.io/wakassets/icons/di.png',
  armor: 'https://vertylo.github.io/wakassets/aptitudes/234.png',
  heal: 'https://vertylo.github.io/wakassets/aptitudes/12.png',
};

const STAT_LABEL_KEYS: Record<EntityStatKind, string> = {
  damage: 'damageMeter.statDamage',
  armor: 'damageMeter.statArmor',
  heal: 'damageMeter.statHeal',
};

/**
 * Sélecteur Dommage/Armure/Soin affiché à côté du switch Cumulé/Tour (voir CombatDetailComponent,
 * `.combat-switch-row`) — un combat (en cours ou de l'historique) n'affiche qu'un seul type de
 * statistique par entité à la fois, tributaire du même switch cumulé/tour. Icônes seules (pas de
 * libellé) pour rester compact sur la même ligne que le switch Cumulé/Tour — le libellé reste
 * accessible via tooltip (`TooltipDirective`, voir CLAUDE.md).
 */
@Component({
  selector: 'app-entity-stat-tabs',
  imports: [TranslatePipe, TooltipDirective],
  templateUrl: './entity-stat-tabs.component.html',
  styleUrl: './entity-stat-tabs.component.css',
})
export class EntityStatTabsComponent {
  readonly kind = input.required<EntityStatKind>();
  readonly kindChange = output<EntityStatKind>();

  protected readonly kinds: readonly EntityStatKind[] = ['damage', 'armor', 'heal'];
  protected readonly icons = STAT_ICON_URLS;
  protected readonly labelKeys = STAT_LABEL_KEYS;

  protected select(kind: EntityStatKind): void {
    if (kind !== this.kind()) this.kindChange.emit(kind);
  }
}
