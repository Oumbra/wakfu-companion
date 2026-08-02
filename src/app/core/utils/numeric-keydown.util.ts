/** Action à appliquer pour une touche pressée dans un input restreint aux chiffres et piloté par
 * les flèches haut/bas (voir suivi > mode décompte, `.kpi-countdown-input`/`.kpi-card-countdown-input`). */
export type NumericKeyAction = 'block' | 'increment' | 'decrement' | 'allow';

/** Touches de navigation/édition à toujours laisser passer, même si elles ne sont pas des chiffres. */
const ALLOWED_CONTROL_KEYS = new Set([
  'Backspace',
  'Delete',
  'Tab',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'Enter',
  'Escape',
]);

/** Classe une touche pressée dans un input numérique entier restreint aux chiffres :
 * `increment`/`decrement` pour les flèches haut/bas, `block` pour tout caractère imprimable
 * qui n'est pas un chiffre, `allow` pour le reste (chiffres, navigation, raccourcis
 * copier/coller/sélection). */
export function resolveNumericKeyAction(event: KeyboardEvent): NumericKeyAction {
  if (event.key === 'ArrowUp') return 'increment';
  if (event.key === 'ArrowDown') return 'decrement';
  if (event.ctrlKey || event.metaKey || event.altKey) return 'allow';
  if (ALLOWED_CONTROL_KEYS.has(event.key)) return 'allow';
  if (event.key.length === 1 && !/^[0-9]$/.test(event.key)) return 'block';
  return 'allow';
}
