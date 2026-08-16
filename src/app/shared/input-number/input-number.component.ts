import { Component, computed, ElementRef, input, output, viewChild } from '@angular/core';
import { TooltipDirective } from '../tooltip/tooltip.directive';

/** Touches de navigation/édition à toujours laisser passer, même si elles ne sont pas des
 * chiffres — les 4 flèches en sont volontairement absentes : ce composant les réaffecte toutes au
 * pas à pas (voir `onKeydown` — gauche/bas diminuent, droite/haut augmentent) plutôt qu'au
 * déplacement de curseur standard (gauche/droite) ou au stepper natif du navigateur (haut/bas, non
 * fiable d'un navigateur à l'autre — gérer nous-mêmes garantit le même bornage/la même émission
 * que les boutons +/- et la molette). */
const ALLOWED_KEYS = new Set(['Backspace', 'Delete', 'Tab', 'Home', 'End', 'Enter', 'Escape']);

/**
 * Champ numérique générique, éditable au clavier (frappe directe, chiffres uniquement) ET
 * pilotable via boutons +/- optionnels, flèches clavier (← ↓ diminuent, → ↑ augmentent) ou molette
 * — ciblable au `Tab` comme n'importe quel `<input>` (c'en est un, contrairement à
 * `app-stepper`/`shared/stepper/` qui n'affiche qu'un libellé non éditable). `value()` est la
 * valeur de départ/affichée, contrôlée par l'appelant (composant contrôlé, même principe que
 * `app-stepper`) : l'appelant reste responsable de la persister via `(valueChange)`. `min`/`max`
 * sont optionnels (`null` = pas de borne dans ce sens).
 *
 * Remplace les blocs `.kpi-target-stepper` (tracker/tracker-strip), `.item-picker-qty-stepper`
 * (item-picker), `.kpi-card-value-input`/`.kpi-countdown-current-input` (décompte watchlist) et
 * `.recipe-modal-qty-input` (modale recette) — 6 implémentations quasi identiques (boutons +/-,
 * blocage des caractères non numériques, bornage min/max) fusionnées ici. L'habillage visuel de
 * chaque appelant (tailles/couleurs qui différaient légèrement d'un usage à l'autre) reste
 * personnalisable via les variables CSS `--input-number-*` posées sur la balise `<app-input-number>`
 * elle-même depuis le CSS du composant appelant (héritées à travers `:host{display:contents}`,
 * voir `input-number.component.css`) — voir CLAUDE.md, section "Toujours un composant, jamais un
 * bloc local".
 */
@Component({
  selector: 'app-input-number',
  imports: [TooltipDirective],
  templateUrl: './input-number.component.html',
  styleUrl: './input-number.component.css',
})
export class InputNumberComponent {
  /** Valeur affichée/de départ — composant contrôlé, l'appelant reste responsable de la persister
   * via `(valueChange)` (même principe que `app-stepper`). */
  readonly value = input.required<number>();
  /** Borne basse — `null` (défaut) = pas de minimum. */
  readonly min = input<number | null>(null);
  /** Borne haute — `null` (défaut) = pas de maximum. */
  readonly max = input<number | null>(null);
  /** Pas appliqué aux boutons +/-, aux flèches clavier et à la molette — 1 par défaut. */
  readonly step = input(1);
  /** Affiche ou masque les boutons +/- (désactiver pour un champ compact sans place, ex. tuile KPI
   * repliée — le champ garde alors sa propre bordure plutôt que celle, partagée, du groupe
   * bouton|champ|bouton, voir `.no-buttons` dans le CSS). */
  readonly showButtons = input(true);
  readonly prevTooltip = input<string | null>(null);
  readonly nextTooltip = input<string | null>(null);
  /** Tooltip du champ lui-même (distinct de `prevTooltip`/`nextTooltip`, portés par les boutons). */
  readonly fieldTooltip = input<string | null>(null);

  /** Émis à chaque frappe (valeur brute, non bornée — ne pas lutter contre l'utilisateur qui
   * efface le champ pour retaper un nombre, voir CLAUDE.md) ET, déjà bornée cette fois, à chaque
   * clic bouton/flèche clavier/molette/perte de focus. */
  readonly valueChange = output<number>();

  private readonly fieldEl = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly canDecrement = computed(() => this.value() > (this.min() ?? -Infinity));
  protected readonly canIncrement = computed(() => this.value() < (this.max() ?? Infinity));

  /** Focus programmatique (voir RecipeQuantityModalComponent, qui focus ce champ à l'ouverture de
   * la modale) — expose le champ interne sans que l'appelant ait à connaître sa structure DOM. */
  focus(): void {
    this.fieldEl()?.nativeElement.focus();
  }

  private clampValue(v: number): number {
    let out = v;
    const lo = this.min();
    const hi = this.max();
    if (lo !== null) out = Math.max(lo, out);
    if (hi !== null) out = Math.min(hi, out);
    return out;
  }

  protected move(direction: -1 | 1): void {
    const next = this.clampValue(this.value() + direction * this.step());
    if (next !== this.value()) this.valueChange.emit(next);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      this.move(-1);
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.move(1);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (ALLOWED_KEYS.has(event.key)) return;
    if (event.key.length === 1 && !/^[0-9]$/.test(event.key)) event.preventDefault();
  }

  protected onInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    if (raw === '') return; // laisser l'utilisateur vider le champ sans forcer une valeur
    const num = Number(raw);
    if (Number.isFinite(num)) this.valueChange.emit(num);
  }

  /** Filet de sécurité à la perte de focus : borne (et corrige visuellement si besoin) une valeur
   * tapée librement pendant la frappe (voir `onInput`, jamais bornée). */
  protected onBlur(event: FocusEvent): void {
    const el = event.target as HTMLInputElement;
    const raw = Number(el.value);
    const clamped = Number.isFinite(raw) ? this.clampValue(raw) : this.value();
    el.value = String(clamped);
    if (clamped !== this.value()) this.valueChange.emit(clamped);
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.move(event.deltaY < 0 ? 1 : -1);
  }
}
