import {
  Component,
  effect,
  ElementRef,
  input,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CLASS_ICON_DATA_URI } from '../../core/data/class-icons.data';
import { TranslatePipe } from '../translate.pipe';

export interface ClassPickerPosition {
  name: string;
  x: number;
  y: number;
}

interface ClassOption {
  key: string;
  label: string;
  icon: string;
}

const CLASS_OPTIONS: ClassOption[] = Object.keys(CLASS_ICON_DATA_URI)
  .sort()
  .map((key) => ({
    key,
    label: key.charAt(0).toUpperCase() + key.slice(1),
    icon: CLASS_ICON_DATA_URI[key],
  }));

/**
 * Petit menu de sélection de classe (par image), positionné au point de
 * clic. Réutilisé partout où un allié dont la classe n'a pas été détectée
 * automatiquement peut se voir assigner une classe manuellement.
 */
@Component({
  selector: 'app-class-picker',
  imports: [TranslatePipe],
  templateUrl: './class-picker.component.html',
  styleUrl: './class-picker.component.css',
})
export class ClassPickerComponent implements OnDestroy {
  readonly position = input.required<ClassPickerPosition>();
  readonly classChosen = output<string>();
  readonly closed = output<void>();

  protected readonly classOptions = CLASS_OPTIONS;

  private readonly pickerEl = viewChild<ElementRef<HTMLDivElement>>('picker');
  /** Position affichée, recalée pour ne jamais déborder du viewport (le clic
   * droit d'origine peut arriver près du bord droit/bas de l'écran, la
   * largeur du menu — 6 colonnes fixes — dépassant alors l'écran). Mesurée
   * via ResizeObserver plutôt qu'une seule lecture d'`offsetWidth` dans
   * l'effet : au tout premier passage, la grille CSS (icônes) n'a pas encore
   * fini son layout (largeur transitoire ~52px au lieu des ~256px finaux),
   * ce qui donnait un calcul de bord faux — le ResizeObserver se déclenche à
   * nouveau une fois la taille réelle atteinte et corrige la position. */
  protected readonly displayPosition = signal({ left: 0, top: 0 });
  private resizeObserver?: ResizeObserver;

  constructor() {
    effect(() => {
      this.position();
      const el = this.pickerEl()?.nativeElement;
      this.resizeObserver?.disconnect();
      if (!el) return;
      this.resizeObserver = new ResizeObserver(() => this.updateDisplayPosition(el));
      this.resizeObserver.observe(el);
      this.updateDisplayPosition(el);
    });
  }

  private updateDisplayPosition(el: HTMLElement): void {
    const pos = this.position();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - el.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - el.offsetHeight - margin);
    this.displayPosition.set({
      left: Math.min(pos.x, maxLeft),
      top: Math.min(pos.y, maxTop),
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  protected choose(className: string): void {
    this.classChosen.emit(className);
  }

  protected close(): void {
    this.closed.emit();
  }
}
