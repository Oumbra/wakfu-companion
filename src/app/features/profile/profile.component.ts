import { Component, inject, signal } from '@angular/core';
import { ProfileService } from '../../core/services/profile.service';
import { I18nService } from '../../core/services/i18n.service';
import { AvatarIconComponent } from '../../shared/avatar-icon/avatar-icon.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { BREEDS_SPRITE_COLS, BREEDS_SPRITE_ROWS } from '../../core/data/class-breeds.data';

/** Bouton profil (haut à droite) + modal : pseudo, avatar (planche Ankama), et liste d'objets à alerte sonore au ramassage. */
@Component({
  selector: 'app-profile',
  imports: [AvatarIconComponent, ItemIconComponent, TranslatePipe],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.css',
})
export class ProfileComponent {
  protected readonly profile = inject(ProfileService);
  protected readonly i18n = inject(I18nService);

  protected readonly open = signal(false);
  protected readonly newItemName = signal('');
  protected readonly avatarIndexes = Array.from(
    { length: BREEDS_SPRITE_COLS * BREEDS_SPRITE_ROWS },
    (_, i) => i,
  );

  protected toggle(): void {
    this.open.update((v) => !v);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected onPseudoInput(value: string): void {
    this.profile.setPseudo(value);
  }

  protected chooseAvatar(index: number): void {
    this.profile.setAvatar(index);
  }

  protected setNewItemName(value: string): void {
    this.newItemName.set(value);
  }

  protected addSoundItem(): void {
    this.profile.addSoundItem(this.newItemName());
    this.newItemName.set('');
  }

  protected toggleSound(name: string): void {
    this.profile.toggleSoundItem(name);
  }

  protected removeSoundItem(name: string): void {
    this.profile.removeSoundItem(name);
  }
}
