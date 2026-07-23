import { Component, computed, inject } from '@angular/core';
import { ProfileService } from '../../core/services/profile.service';
import { NavigationService } from '../../core/services/navigation.service';
import { I18nService } from '../../core/services/i18n.service';
import { AlertSoundService } from '../../core/services/alert-sound.service';
import { AvatarIconComponent } from '../../shared/avatar-icon/avatar-icon.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { BREEDS_SPRITE_COLS, BREEDS_SPRITE_ROWS } from '../../core/data/class-breeds.data';
import { getWakfuItemRarity } from '../../core/data/wakfu-item-rarity.data';
import { WakfuAutocompleteComponent } from '../../shared/wakfu-autocomplete/wakfu-autocomplete.component';
import { WakfuSearchResult } from '../../core/services/wakfu-search.service';

/** Page dédiée au profil (pseudo, avatar, alertes sonores de butin) — voir NavigationService pour le slide d'entrée/sortie. */
@Component({
  selector: 'app-profile-page',
  imports: [AvatarIconComponent, ItemIconComponent, TranslatePipe, WakfuAutocompleteComponent],
  templateUrl: './profile-page.component.html',
  styleUrl: './profile-page.component.css',
})
export class ProfilePageComponent {
  protected readonly profile = inject(ProfileService);
  protected readonly i18n = inject(I18nService);
  private readonly nav = inject(NavigationService);
  private readonly alertSound = inject(AlertSoundService);

  protected readonly avatarIndexes = Array.from(
    { length: BREEDS_SPRITE_COLS * BREEDS_SPRITE_ROWS },
    (_, i) => i,
  );

  protected readonly existingSoundItemNames = computed(() =>
    this.profile.soundItems().map((entry) => ({ name: entry.name, kind: 'item' as const })),
  );

  protected goBack(): void {
    this.nav.goToMain();
  }

  protected onPseudoInput(value: string): void {
    this.profile.setPseudo(value);
  }

  protected chooseAvatar(index: number): void {
    this.profile.setAvatar(index);
  }

  protected onDurationInput(value: string): void {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) this.profile.setAlertDuration(seconds);
  }

  protected setManualClose(value: boolean): void {
    this.profile.setAlertManualClose(value);
  }

  protected testAlertSound(): void {
    this.alertSound.play();
  }

  protected manualCloseTooltip(): string {
    if (this.profile.alertManualClose()) {
      return this.i18n.t('profile.manualCloseTooltip');
    }
    const seconds = this.profile.alertDurationSeconds();
    const key = seconds === 1 ? 'profile.autoCloseTooltipSingular' : 'profile.autoCloseTooltipPlural';
    return this.i18n.t(key, { seconds });
  }

  protected addSoundItem(result: WakfuSearchResult): void {
    this.profile.addSoundItem(result.name);
  }

  protected toggleSound(name: string): void {
    this.profile.toggleSoundItem(name);
  }

  protected removeSoundItem(name: string): void {
    this.profile.removeSoundItem(name);
  }

  protected rarityClass(name: string): string {
    return `rarity-${getWakfuItemRarity(name)}`;
  }
}
