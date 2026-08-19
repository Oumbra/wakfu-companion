import { Component, computed, inject, input, output, signal } from '@angular/core';
import { ClassPickerService } from '../../../core/services/class-picker.service';
import { Gender } from '../../../core/data/class-icons.data';
import { AVATAR_GRID_ENTRIES, getAvatarGridIndex } from '../../../core/data/class-portraits.data';
import { TranslatePipe } from '../../../shared/translate.pipe';
import { TooltipDirective } from '../../../shared/tooltip/tooltip.directive';
import { AvatarIconComponent } from '../../../shared/avatar-icon/avatar-icon.component';
import { DirectionalSlideshowComponent } from '../../../shared/directional-slideshow/directional-slideshow.component';
import { MediaQuerySignal } from '../../../core/utils/media-query-signal';

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
  imports: [TranslatePipe, TooltipDirective, AvatarIconComponent, DirectionalSlideshowComponent],
  templateUrl: './character-add-form.component.html',
  styleUrl: './character-add-form.component.css',
})
export class CharacterAddFormComponent {
  private readonly classPickerService = inject(ClassPickerService);
  readonly switchModeBlocked = input<boolean>(false);
  readonly added = output<NewRosterCharacter>();

  protected readonly isMobile = new MediaQuerySignal('(max-width: 800px)');
  protected readonly pendingClass = signal<{ className: string; gender: Gender } | null>(null);
  protected readonly name = signal('');

  /** Portrait (planche Ankama, voir class-portraits.data.ts) plutôt que la petite icône carrée :
   * plus lisible dans ce formulaire, cohérent avec le mode 'portraits' du picker ouvert ci-dessous. */
  protected readonly avatarIndex = computed(() => {
    const pending = this.pendingClass();
    return pending ? getAvatarGridIndex(pending.className, pending.gender) : null;
  });

  protected readonly canAdd = computed(
    () => this.pendingClass() !== null && this.name().trim().length > 0,
  );

  /** Les 36 portraits (18 classes x 2 sexes, voir AVATAR_GRID_ENTRIES) proposés en boucle par
   * `app-directional-slideshow` (voir character-add-form.component.html) tant qu'aucune classe
   * n'est choisie — le tirage aléatoire (sans répétition consécutive) est géré par ce composant,
   * pas besoin de mélanger la liste ici. */
  protected readonly avatarIndices: readonly number[] = AVATAR_GRID_ENTRIES.map((_, i) => i);

  protected setName(value: string): void {
    this.name.set(value);
  }

  protected openClassPicker(event: MouseEvent): void {
    this.classPickerService.open(
      this.name().trim(),
      event.clientX,
      event.clientY,
      (className, gender) => {
        this.pendingClass.set({ className, gender });
      },
      this.isMobile.matches() ? 'icons' : 'portraits',
      this.switchModeBlocked(),
    );
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
