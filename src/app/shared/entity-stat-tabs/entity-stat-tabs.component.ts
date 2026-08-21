import { Component, input, output } from '@angular/core';
import { TranslatePipe } from '../translate.pipe';

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
 * Sélecteur Dommage/Armure/Soin affiché sous le switch Cumulé/Tour (DamageViewSwitchComponent) —
 * un combat (en cours ou de l'historique) n'affiche qu'un seul type de statistique par entité à la
 * fois, tributaire du même switch cumulé/tour (voir DamageMeterComponent/FightHistoryComponent).
 * Contrairement au switch Cumulé/Tour (`.icon-switch`, encart bordé/arrondi centré), celui-ci
 * occupe toute la largeur du panneau, sans marge/bordure/arrondi, chaque option affichant son
 * libellé (pas seulement une icône) — maquette fournie par l'utilisateur.
 */
@Component({
  selector: 'app-entity-stat-tabs',
  imports: [TranslatePipe],
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
