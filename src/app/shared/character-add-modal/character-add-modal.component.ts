import { Component, inject } from '@angular/core';
import { CharacterAddModalService } from '../../core/services/character-add-modal.service';
import { CharacterRosterService } from '../../core/services/character-roster.service';
import {
  CharacterAddFormComponent,
  NewRosterCharacter,
} from '../../features/profile-page/character-add-form/character-add-form.component';
import { TranslatePipe } from '../translate.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';

/**
 * Modale "ajouter un personnage" (desktop — voir CharacterAddModalService) : rendue une seule
 * fois au niveau racine (voir app.html, même principe que RecipeQuantityModalComponent) pour ne
 * jamais hériter d'un ancêtre `transform` qui casserait son positionnement (voir CLAUDE.md).
 * Enrobe `app-character-add-form` (identique à la version inline mobile) dans une présentation
 * modale — la validation ajoute directement le personnage au compte ciblé puis referme, sans
 * repasser par ProfilePageComponent.
 */
@Component({
  selector: 'app-character-add-modal',
  imports: [CharacterAddFormComponent, TranslatePipe, TooltipDirective],
  templateUrl: './character-add-modal.component.html',
  styleUrl: './character-add-modal.component.css',
})
export class CharacterAddModalComponent {
  protected readonly characterAddModal = inject(CharacterAddModalService);
  private readonly roster = inject(CharacterRosterService);

  protected onAdded(accountId: string, character: NewRosterCharacter): void {
    this.roster.addCharacter(accountId, character.name, character.className, character.gender);
    this.close();
  }

  protected close(): void {
    this.characterAddModal.close();
  }
}
