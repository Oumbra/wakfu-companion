import { Component, computed, inject, output, signal } from '@angular/core';
import { ClassPickerService } from '../../../core/services/class-picker.service';
import { Gender, getClassIconUri } from '../../../core/data/class-icons.data';
import { TranslatePipe } from '../../../shared/translate.pipe';

export interface NewRosterCharacter {
  name: string;
  className: string;
  gender: Gender;
}

/**
 * Formulaire inline d'ajout d'un personnage à un compte : icône de classe
 * (ouvre le ClassPickerService partagé) puis nom, le bouton "+" ne
 * s'active que lorsque les deux sont renseignés — état local à ce
 * formulaire (pas remonté au parent avant la validation).
 */
@Component({
  selector: 'app-character-add-form',
  imports: [TranslatePipe],
  templateUrl: './character-add-form.component.html',
  styleUrl: './character-add-form.component.css',
})
export class CharacterAddFormComponent {
  private readonly classPickerService = inject(ClassPickerService);
  readonly added = output<NewRosterCharacter>();

  protected readonly pendingClass = signal<{ className: string; gender: Gender } | null>(null);
  protected readonly name = signal('');

  protected readonly icon = computed(() => {
    const pending = this.pendingClass();
    return getClassIconUri(pending?.className, pending?.gender ?? 'm');
  });

  protected readonly canAdd = computed(() => this.pendingClass() !== null && this.name().trim().length > 0);

  protected setName(value: string): void {
    this.name.set(value);
  }

  protected openClassPicker(event: MouseEvent): void {
    this.classPickerService.open(this.name().trim(), event.clientX, event.clientY, (className, gender) => {
      this.pendingClass.set({ className, gender });
    });
  }

  protected commit(): void {
    const pending = this.pendingClass();
    const name = this.name().trim();
    if (!pending || !name) return;
    this.added.emit({ name, className: pending.className, gender: pending.gender });
    this.name.set('');
    this.pendingClass.set(null);
  }
}
