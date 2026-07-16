import { Component, input, output } from '@angular/core';
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
export class ClassPickerComponent {
  readonly position = input.required<ClassPickerPosition>();
  readonly classChosen = output<string>();
  readonly closed = output<void>();

  protected readonly classOptions = CLASS_OPTIONS;

  protected choose(className: string): void {
    this.classChosen.emit(className);
  }

  protected close(): void {
    this.closed.emit();
  }
}
