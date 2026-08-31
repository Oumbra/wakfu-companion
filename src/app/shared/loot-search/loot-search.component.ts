import { Component, input, output } from '@angular/core';
import { TooltipDirective } from '../tooltip/tooltip.directive';

/**
 * Champ de recherche par nom d'objet, réutilisé par FightHistoryComponent (butin d'un combat) et
 * SessionRecapComponent (butin de session/période/groupe — 3 appelants internes) — même contrôle
 * (composant contrôlé, `[value]`/`(valueChange)`, même principe qu'app-input-number/app-stepper,
 * voir CLAUDE.md conventions UI transverses) plutôt qu'un bloc `.loot-search-wrap` recopié à
 * chaque appelant. Icône loupe fixe à gauche, croix d'effacement affichée SEULEMENT quand
 * `value()` n'est pas vide (voir template) — ce dernier point n'existait sur aucun des appelants
 * avant l'extraction de ce composant, ajouté ici une fois pour tous.
 *
 * `:host` porte directement le rôle de conteneur (`position:relative; display:flex; flex:1`) —
 * pas de wrapper interne supplémentaire : l'appelant place `<app-loot-search>` à l'endroit voulu
 * de sa propre ligne de contrôles (`.loot-controls-row`), le composant occupe l'espace restant de
 * cette ligne comme le ferait n'importe quel enfant flex `flex:1`.
 */
@Component({
  selector: 'app-loot-search',
  imports: [TooltipDirective],
  templateUrl: './loot-search.component.html',
  styleUrl: './loot-search.component.css',
})
export class LootSearchComponent {
  readonly value = input('');
  readonly placeholder = input.required<string>();
  readonly clearTooltip = input.required<string>();

  readonly valueChange = output<string>();

  protected onInput(event: Event): void {
    this.valueChange.emit((event.target as HTMLInputElement).value);
  }

  protected clear(): void {
    this.valueChange.emit('');
  }
}
