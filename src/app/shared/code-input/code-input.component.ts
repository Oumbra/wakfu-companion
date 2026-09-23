import { Component, input, output } from '@angular/core';

/**
 * Normalise une saisie de code court (appairage, confirmation...) : majuscules, et seuls les
 * caractères `[A-Z0-9]` sont conservés — espaces, tirets et autres séparateurs qu'un utilisateur
 * recopie spontanément depuis un autre écran sont ignorés. Exportée pour que l'appelant compare
 * exactement la même forme que celle affichée.
 */
export function normalizeCode(raw: string, maxLength: number): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, maxLength);
}

/**
 * Champ de saisie d'un code court à recopier depuis un autre écran (ex. code affiché par l'overlay
 * natif, voir `NativePairComponent`) — composant contrôlé, même principe que `app-input-number` :
 * `value()` est la valeur affichée, `(valueChange)` émet la valeur déjà normalisée (voir
 * `normalizeCode`). Police à chasse fixe, sans correction orthographique ni saisie automatique :
 * le code doit être RESAISI par l'utilisateur, jamais proposé par le navigateur.
 */
@Component({
  selector: 'app-code-input',
  templateUrl: './code-input.component.html',
  styleUrl: './code-input.component.css',
})
export class CodeInputComponent {
  readonly value = input.required<string>();
  readonly maxLength = input(16);
  readonly placeholder = input('');
  /** Libellé accessible (le libellé visible, s'il existe, est à la charge de l'appelant). */
  readonly ariaLabel = input<string | null>(null);
  readonly inputId = input<string | null>(null);
  readonly disabled = input(false);
  readonly valueChange = output<string>();
  /** Entrée pressée dans le champ (validation au clavier). */
  readonly submitted = output<void>();

  protected onInput(event: Event): void {
    const field = event.target as HTMLInputElement;
    const normalized = normalizeCode(field.value, this.maxLength());
    // Réécrit le champ immédiatement : sinon un caractère refusé resterait affiché tant que la
    // valeur contrôlée (`value()`) ne change pas.
    if (field.value !== normalized) field.value = normalized;
    this.valueChange.emit(normalized);
  }
}
