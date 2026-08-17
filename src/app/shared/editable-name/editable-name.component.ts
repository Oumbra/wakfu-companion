import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TooltipDirective } from '../tooltip/tooltip.directive';
import { TooltipPosition } from '../../core/services/tooltip.service';
import { IconComponent } from '../icon/icon.component';
import { focusInlineEditInput } from '../../core/utils/inline-edit-focus';

export type EditableNameVariant = 'centered' | 'inline';

/**
 * Nom affiché + bouton crayon qui bascule vers un champ de saisie (blur/Entrée valide, Échap
 * annule) — extrait du pseudo (avatar) et du renommage de personnage (grille/liste), qui
 * partageaient exactement ce mécanisme en trois copies quasi identiques dans
 * ProfilePageComponent. Réutilisé aussi pour le nom de compte (voir profile-page.component.html),
 * qui n'avait pas ce bascule crayon auparavant (simple `<input>` toujours visible) — uniformisé
 * pour cohérence.
 *
 * État d'édition entièrement local au composant (pas remonté au parent avant validation) : le
 * parent ne reçoit que la valeur finale via `(renamed)`, à lui de décider s'il l'accepte (trim,
 * rejet si vide/inchangé...) — cf. `commitPseudo`/`renameCharacter`/`renameAccount` dans
 * ProfilePageComponent, la logique métier diffère d'un appelant à l'autre (le pseudo accepte une
 * valeur vide pour l'effacer, pas le nom de personnage/compte).
 */
@Component({
  selector: 'app-editable-name',
  imports: [TooltipDirective, IconComponent],
  host: {
    '[attr.data-variant]': 'variant()',
    '[style.cursor]': 'editing() ? "text": "pointer"',
    '(click)': 'start()',
  },
  hostDirectives: [TooltipDirective],
  templateUrl: './editable-name.component.html',
  styleUrl: './editable-name.component.css',
})
export class EditableNameComponent {
  readonly value = input.required<string>();
  readonly placeholder = input('');
  /** Texte affiché à la place de `value()` quand celle-ci est vide (ex. "Aucun pseudo défini") —
   * `null` (défaut) pour ne rien afficher dans ce cas (le nom d'un personnage/compte n'est jamais
   * vide en pratique). */
  readonly emptyText = input<string | null>(null);
  readonly editTooltip = input.required<string>();
  readonly variant = input<EditableNameVariant>('centered');
  /** Bouton crayon sans fond/bordure (voir `.plain-icon-btn`, styles.css) — utilisé en vue grille
   * où la tuile porte déjà son propre fond au survol. */
  readonly plainEditButton = input(false);
  /** Tooltip sur le nom affiché lui-même (uniquement si tronqué, voir `[tooltipOnlyIfTruncated]`)
   * — utile quand la valeur peut dépasser l'espace dispo (nom de personnage), pas pour un pseudo
   * centré sur peu de largeur. */
  readonly showValueTooltip = input(false);
  readonly valueTooltipPosition = input<TooltipPosition>('top-right');
  /** Posé sur le `<input>` interne (voir `[attr.id]`) pour relier un `<label for="...">` externe
   * — nécessaire uniquement pour la variante "champ de formulaire" (nom de compte, desktop). */
  readonly inputId = input<string | null>(null);

  /** Valeur brute (non triminée) saisie par l'utilisateur, à la validation (blur ou Entrée) —
   * voir doc de classe, le parent décide de la logique d'acceptation. */
  readonly renamed = output<string>();

  protected readonly editing = signal(false);
  private readonly editInput = viewChild<ElementRef<HTMLInputElement>>('editInput');
  private readonly tooltipDirective = inject(TooltipDirective);
  private readonly tooltipText = computed(() => (this.editing() ? null : this.editTooltip()));

  constructor() {
    focusInlineEditInput(this.editing, this.editInput);
    effect(() => this.tooltipDirective.appTooltip.set(this.tooltipText()));
  }

  protected start(): void {
    if (this.editing()) return;
    this.editing.set(true);
    this.tooltipDirective.hide();
  }

  /** Appelé à la fois par (blur) et par Entrée — le garde-fou `editing()` évite qu'un blur
   * déclenché par la fermeture du champ (Entrée déjà traitée, ou Échap qui annule) ne réémette la
   * valeur tapée une seconde fois. */
  protected commit(value: string): void {
    if (!this.editing()) return;
    this.editing.set(false);
    this.renamed.emit(value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.commit((event.target as HTMLInputElement).value);
    } else if (event.key === 'Escape') {
      this.editing.set(false);
    }
  }
}
