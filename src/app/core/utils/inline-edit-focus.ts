import { effect, ElementRef, Signal } from '@angular/core';

/**
 * Focus + sélectionne le contenu d'un champ d'édition inline dès qu'il apparaît dans le DOM (voir
 * pseudo/personnage dans profile-page.component.ts) — factorise le seul `effect()` identique entre
 * les deux, pas l'état d'édition lui-même (une valeur booléenne pour le pseudo, une clé composée
 * pour le personnage : pas la même forme, pas fusionnable sans perdre en clarté). À appeler depuis
 * le constructeur d'un composant (contexte d'injection requis par `effect()`).
 */
export function focusInlineEditInput(
  isEditing: Signal<boolean>,
  input: Signal<ElementRef<HTMLInputElement> | undefined>,
): void {
  effect(() => {
    const el = input();
    if (isEditing() && el) {
      el.nativeElement.focus();
      el.nativeElement.select();
    }
  });
}
