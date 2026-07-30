import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { ProfileService } from '../../core/services/profile.service';
import { AppDataExportService } from '../../core/services/app-data-export.service';
import { NavigationService } from '../../core/services/navigation.service';
import { I18nService } from '../../core/services/i18n.service';
import { AlertSoundService } from '../../core/services/alert-sound.service';
import { ConfirmDeleteService } from '../../core/services/confirm-delete.service';
import { AvatarIconComponent } from '../../shared/avatar-icon/avatar-icon.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import {
  BREEDS_SPRITE_COLS,
  BREEDS_SPRITE_ROWS,
  getBreedAvatarIndex,
} from '../../core/data/class-breeds.data';
import { getWakfuItemRarity } from '../../core/data/wakfu-item-rarity.data';
import { WakfuAutocompleteComponent } from '../../shared/wakfu-autocomplete/wakfu-autocomplete.component';
import { WakfuSearchResult } from '../../core/services/wakfu-search.service';
import {
  CharacterRosterService,
  RosterAccount,
  RosterCharacter,
} from '../../core/services/character-roster.service';
import { getClassIconUri } from '../../core/data/class-icons.data';
import {
  CharacterAddFormComponent,
  NewRosterCharacter,
} from './character-add-form/character-add-form.component';

type ProfileTab = 'avatar' | 'alerts' | 'characters';

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
  private readonly dataExport = inject(AppDataExportService);
  private readonly nav = inject(NavigationService);
  private readonly alertSound = inject(AlertSoundService);
  private readonly confirmDelete = inject(ConfirmDeleteService);

  protected readonly avatarIndexes = Array.from(
    { length: BREEDS_SPRITE_COLS * BREEDS_SPRITE_ROWS },
    (_, i) => i,
  );

  protected readonly existingSoundItemNames = computed(() =>
    this.profile.soundItems().map((entry) => ({ name: entry.name, kind: 'item' as const })),
  );

  private readonly pseudoEditInput = viewChild<ElementRef<HTMLInputElement>>('pseudoEditInput');
  protected readonly editingPseudo = signal(false);

  /** Personnage actuellement en cours de renommage (un seul à la fois, tous
   * comptes confondus) — même principe que `editingPseudo`/`pseudoEditInput`. */
  protected readonly editingCharacter = signal<{ accountId: string; name: string } | null>(null);
  private readonly charEditInput = viewChild<ElementRef<HTMLInputElement>>('charEditInput');
  private charDragIndex: number | null = null;

  /** Onglets de la page profil (Avatar/Alertes/Personnages), même principe
   * que la barre d'onglets mobile du dashboard : 3 largeurs égales, fond +
   * bordure glissants en CSS pur via `--active-tab-index` (voir
   * dashboard.component.css `.tab-slider`). Chaque section reste montée en
   * permanence (juste masquée via `.tab-hidden`) pour conserver son état. */
  protected readonly activeTab = signal<ProfileTab>('avatar');
  private static readonly TAB_ORDER: readonly ProfileTab[] = ['avatar', 'alerts', 'characters'];
  protected readonly activeTabIndex = computed(() =>
    ProfilePageComponent.TAB_ORDER.indexOf(this.activeTab()),
  );

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

  /** Même principe que `soundGridColumns` ci-dessus, pour la vue grille des
   * personnages (voir `.roster-character-list.is-grid` en CSS — valeurs à
   * garder synchronisées avec `CHAR_GRID_GAP`/`CHAR_GRID_MIN_COL`). */
  private static readonly CHAR_GRID_GAP = 8;
  private static readonly CHAR_GRID_MIN_COL = 120;
  private readonly charGrid = viewChild<ElementRef<HTMLDivElement>>('charGrid');
  protected readonly charGridColumns = signal(1);
  private charGridResizeObserver?: ResizeObserver;

  /** Onglet de compte actif (voir `.roster-tab-bar`, même principe que les
   * onglets Combat/Suivi/Chat du dashboard mobile) — signal en mémoire
   * seulement, pas persisté, comme `DashboardComponent.activeTab`. */
  protected readonly selectedAccountId = signal<string | null>(null);
  protected readonly selectedAccount = computed<RosterAccount | null>(
    () => this.roster.accounts().find((a) => a.id === this.selectedAccountId()) ?? null,
  );

  private readonly tabBar = viewChild<ElementRef<HTMLDivElement>>('tabBar');
  private readonly tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tabBtn');
  /** Position/largeur (px) du fond+bordure glissants de l'onglet actif — measurée
   * sur le DOM plutôt que calculée en CSS pur, car les onglets ont une largeur
   * variable (nom du compte, jusqu'à `.roster-tab-btn`'s max-width). */
  protected readonly tabSliderRect = signal({ left: 0, width: 0 });
  private tabBarResizeObserver?: ResizeObserver;

  constructor() {
    effect(() => {
      const input = this.pseudoEditInput();
      if (this.editingPseudo() && input) {
        input.nativeElement.focus();
        input.nativeElement.select();
      }
    });

    effect(() => {
      const input = this.charEditInput();
      if (this.editingCharacter() && input) {
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

    effect(() => {
      const el = this.charGrid()?.nativeElement;
      this.charGridResizeObserver?.disconnect();
      if (!el) return;
      this.charGridResizeObserver = new ResizeObserver(() => this.updateCharGridColumns(el));
      this.charGridResizeObserver.observe(el);
      this.updateCharGridColumns(el);
    });

    // Sélectionne le compte principal (ou le 1er) à l'initialisation, et
    // recorrige si le compte sélectionné a été supprimé entretemps.
    effect(() => {
      const accounts = this.roster.accounts();
      const current = this.selectedAccountId();
      if (accounts.some((a) => a.id === current)) return;
      const fallback = accounts.find((a) => a.isDefault) ?? accounts[0];
      this.selectedAccountId.set(fallback?.id ?? null);
    });

    // Repositionne le slider à chaque changement d'onglet actif, de liste de
    // comptes (largeur du bouton peut changer avec le libellé) ou de taille
    // de la barre (redimensionnement fenêtre) — voir ResizeObserver plus bas.
    effect(() => {
      const id = this.selectedAccountId();
      const accounts = this.roster.accounts();
      const buttons = this.tabButtons();
      const index = accounts.findIndex((a) => a.id === id);
      const btn = buttons[index]?.nativeElement;
      this.tabSliderRect.set(btn ? { left: btn.offsetLeft, width: btn.offsetWidth } : { left: 0, width: 0 });
    });

    effect(() => {
      const el = this.tabBar()?.nativeElement;
      this.tabBarResizeObserver?.disconnect();
      if (!el) return;
      this.tabBarResizeObserver = new ResizeObserver(() => this.updateTabSliderRect());
      this.tabBarResizeObserver.observe(el);
    });
  }

  ngOnDestroy(): void {
    this.soundGridResizeObserver?.disconnect();
    this.charGridResizeObserver?.disconnect();
    this.tabBarResizeObserver?.disconnect();
  }

  private updateTabSliderRect(): void {
    const accounts = this.roster.accounts();
    const index = accounts.findIndex((a) => a.id === this.selectedAccountId());
    const btn = this.tabButtons()[index]?.nativeElement;
    this.tabSliderRect.set(btn ? { left: btn.offsetLeft, width: btn.offsetWidth } : { left: 0, width: 0 });
  }

  private updateSoundGridColumns(el: HTMLElement): void {
    const style = getComputedStyle(el);
    const contentWidth =
      el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const { SOUND_GRID_GAP: gap, SOUND_GRID_MIN_COL: minCol } = ProfilePageComponent;
    const columns = Math.max(1, Math.floor((contentWidth + gap) / (minCol + gap)));
    this.soundGridColumns.set(columns);
  }

  private updateCharGridColumns(el: HTMLElement): void {
    const style = getComputedStyle(el);
    const contentWidth =
      el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const { CHAR_GRID_GAP: gap, CHAR_GRID_MIN_COL: minCol } = ProfilePageComponent;
    const columns = Math.max(1, Math.floor((contentWidth + gap) / (minCol + gap)));
    this.charGridColumns.set(columns);
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

  /** Portrait utilisé uniquement en vue grille (voir `.roster-character-avatar`) — même planche que le sélecteur d'avatar, plus flatteuse que les icônes de classe de la vue liste. */
  protected avatarIndexForChar(char: RosterCharacter): number {
    return getBreedAvatarIndex(char.className, char.gender);
  }

  protected addAccount(): void {
    const id = this.roster.addAccount();
    this.selectedAccountId.set(id);
  }

  protected removeAccount(id: string): void {
    this.roster.removeAccount(id);
  }

  /** Suppression via la croix affichée dans l'onglet actif (voir
   * `.roster-tab-remove`) — stoppe la propagation pour ne pas déclencher
   * `selectAccount` porté par le bouton `.roster-tab-btn` englobant. */
  protected removeAccountFromTab(event: MouseEvent, id: string): void {
    event.stopPropagation();
    this.roster.removeAccount(id);
  }

  protected renameAccount(id: string, value: string): void {
    this.roster.renameAccount(id, value);
  }

  protected selectAccount(id: string): void {
    this.selectedAccountId.set(id);
  }

  /** Libellé affiché sur l'onglet : "Principal" pour le compte par défaut
   * (non renommable), le libellé choisi sinon, ou un nom générique tant
   * qu'il n'a pas encore été renseigné. */
  protected tabLabel(account: RosterAccount, index: number): string {
    if (account.isDefault) return this.i18n.t('profile.rosterDefaultAccountLabel');
    return account.label.trim() || this.i18n.t('profile.rosterUnnamedAccount', { index: index + 1 });
  }

  protected requestRemoveCharacter(event: Event, accountId: string, name: string): void {
    event.stopPropagation();
    const button = event.currentTarget as HTMLElement;
    this.confirmDelete.open(button, this.i18n.t('profile.confirmDeleteCharacter'), () => {
      this.roster.removeCharacter(accountId, name);
    });
  }

  protected addCharacterFromForm(accountId: string, character: NewRosterCharacter): void {
    this.roster.addCharacter(accountId, character.name, character.className, character.gender);
  }

  protected isEditingCharacter(accountId: string, name: string): boolean {
    const editing = this.editingCharacter();
    return editing?.accountId === accountId && editing?.name === name;
  }

  protected startEditCharacter(accountId: string, name: string): void {
    this.editingCharacter.set({ accountId, name });
  }

  protected commitCharacterRename(accountId: string, oldName: string, value: string): void {
    const trimmed = value.trim();
    if (trimmed && trimmed !== oldName) this.roster.renameCharacter(accountId, oldName, trimmed);
    this.editingCharacter.set(null);
  }

  protected onCharacterRenameKeydown(event: KeyboardEvent, accountId: string, oldName: string): void {
    if (event.key === 'Enter') {
      this.commitCharacterRename(accountId, oldName, (event.target as HTMLInputElement).value);
    } else if (event.key === 'Escape') {
      this.editingCharacter.set(null);
    }
  }

  protected onCharDragStart(index: number): void {
    this.charDragIndex = index;
  }

  protected onCharDrop(accountId: string, index: number): void {
    if (this.charDragIndex !== null && this.charDragIndex !== index) {
      this.roster.reorderCharacters(accountId, this.charDragIndex, index);
    }
    this.charDragIndex = null;
  }

  /** Déclenche le téléchargement d'un instantané JSON de toutes les données
   * locales (voir AppDataExportService) — nom de fichier horodaté pour
   * distinguer plusieurs exports. */
  protected exportData(): void {
    const payload = this.dataExport.buildExport();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `wakfu-companion-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  protected triggerImport(input: HTMLInputElement): void {
    input.click();
  }

  /** Un import réécrit directement le `localStorage` (voir
   * AppDataExportService) : recharger la page est le moyen le plus sûr de
   * refléter le résultat partout (chaque service/composant se réinitialise
   * proprement depuis les nouvelles valeurs, sans risquer d'oublier de
   * resynchroniser un signal en mémoire quelque part). */
  protected async onImportFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      this.dataExport.applyImport(raw);
      window.location.reload();
    } catch {
      window.alert(this.i18n.t('profile.importError'));
    }
  }
}
