import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
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
import { CharacterRosterService, RosterCharacter } from '../../core/services/character-roster.service';
import { getClassIconUri } from '../../core/data/class-icons.data';
import {
  CharacterAddFormComponent,
  NewRosterCharacter,
} from './character-add-form/character-add-form.component';

/** Page dédiée au profil (pseudo, avatar, alertes sonores de butin) — voir NavigationService pour le slide d'entrée/sortie. */
@Component({
  selector: 'app-profile-page',
  imports: [
    AvatarIconComponent,
    ItemIconComponent,
    TranslatePipe,
    WakfuAutocompleteComponent,
    CharacterAddFormComponent,
  ],
  templateUrl: './profile-page.component.html',
  styleUrl: './profile-page.component.css',
})
export class ProfilePageComponent implements OnDestroy {
  protected readonly profile = inject(ProfileService);
  protected readonly i18n = inject(I18nService);
  protected readonly roster = inject(CharacterRosterService);
  private readonly nav = inject(NavigationService);
  private readonly alertSound = inject(AlertSoundService);

  protected readonly avatarIndexes = Array.from(
    { length: BREEDS_SPRITE_COLS * BREEDS_SPRITE_ROWS },
    (_, i) => i,
  );

  protected readonly existingSoundItemNames = computed(() =>
    this.profile.soundItems().map((entry) => ({ name: entry.name, kind: 'item' as const })),
  );

  private readonly pseudoEditInput = viewChild<ElementRef<HTMLInputElement>>('pseudoEditInput');
  protected readonly editingPseudo = signal(false);

  /** Nombre de colonnes réellement affichées dans `.sound-item-grid` (grid en
   * `auto-fill`, donc variable selon la largeur disponible) — recalculé à
   * chaque redimensionnement via ResizeObserver, pour savoir combien de
   * tuiles composent la 1ère ligne (dont le tooltip doit s'afficher en
   * dessous plutôt qu'au-dessus, sinon rogné par le panneau). Valeurs en dur
   * = copie de `.sound-item-grid` dans profile-page.component.css
   * (`gap: 8px`, `minmax(120px, 1fr)`, `padding: 2px`). */
  private static readonly SOUND_GRID_GAP = 8;
  private static readonly SOUND_GRID_MIN_COL = 120;
  private readonly soundGrid = viewChild<ElementRef<HTMLDivElement>>('soundGrid');
  protected readonly soundGridColumns = signal(1);
  private soundGridResizeObserver?: ResizeObserver;

  constructor() {
    effect(() => {
      const input = this.pseudoEditInput();
      if (this.editingPseudo() && input) {
        input.nativeElement.focus();
        input.nativeElement.select();
      }
    });

    effect(() => {
      const el = this.soundGrid()?.nativeElement;
      this.soundGridResizeObserver?.disconnect();
      if (!el) return;
      this.soundGridResizeObserver = new ResizeObserver(() => this.updateSoundGridColumns(el));
      this.soundGridResizeObserver.observe(el);
      this.updateSoundGridColumns(el);
    });
  }

  ngOnDestroy(): void {
    this.soundGridResizeObserver?.disconnect();
  }

  private updateSoundGridColumns(el: HTMLElement): void {
    const style = getComputedStyle(el);
    const contentWidth =
      el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const { SOUND_GRID_GAP: gap, SOUND_GRID_MIN_COL: minCol } = ProfilePageComponent;
    const columns = Math.max(1, Math.floor((contentWidth + gap) / (minCol + gap)));
    this.soundGridColumns.set(columns);
  }

  protected goBack(): void {
    this.nav.goToMain();
  }

  protected startEditPseudo(): void {
    this.editingPseudo.set(true);
  }

  protected commitPseudo(value: string): void {
    this.profile.setPseudo(value.trim());
    this.editingPseudo.set(false);
  }

  protected onPseudoKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.commitPseudo((event.target as HTMLInputElement).value);
    }
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

  protected characterIcon(char: RosterCharacter): string {
    return getClassIconUri(char.className, char.gender);
  }

  protected addAccount(): void {
    this.roster.addAccount();
  }

  protected removeAccount(id: string): void {
    this.roster.removeAccount(id);
  }

  protected renameAccount(id: string, value: string): void {
    this.roster.renameAccount(id, value);
  }

  protected removeCharacter(accountId: string, name: string): void {
    this.roster.removeCharacter(accountId, name);
  }

  protected addCharacterFromForm(accountId: string, character: NewRosterCharacter): void {
    this.roster.addCharacter(accountId, character.name, character.className, character.gender);
  }
}
