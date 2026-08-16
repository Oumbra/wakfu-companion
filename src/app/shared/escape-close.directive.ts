import { Directive, HostListener, output } from '@angular/core';

/**
 * Ferme la modale/popover/menu hôte quand l'utilisateur appuie sur Échap — à poser sur l'élément
 * racine du contenu (généralement le backdrop, déjà responsable de la fermeture au clic
 * extérieur), lui-même à l'intérieur du bloc `@if` qui conditionne l'affichage. Écoute sur
 * `document` plutôt que sur l'hôte : la plupart de ces overlays (class-picker, item-picker,
 * damage-reassign-picker, menus déroulants...) ne posent aucun focus clavier à l'ouverture, or un
 * `(keydown.escape)` local ne se déclenche que si le focus se trouve dans l'élément — un listener
 * document capte l'appui quel que soit l'élément focus. Vit et meurt avec l'élément hôte (créé/
 * détruit par le `@if`), donc jamais actif quand l'overlay est fermé.
 */
@Directive({
  selector: '[appEscapeClose]',
})
export class EscapeCloseDirective {
  readonly appEscapeClose = output<void>();

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.appEscapeClose.emit();
  }
}
