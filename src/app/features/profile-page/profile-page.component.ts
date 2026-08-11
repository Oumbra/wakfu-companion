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
import { NgClass, NgTemplateOutlet } from '@angular/common';
import { ProfileService } from '../../core/services/profile.service';
import { AppDataExportService } from '../../core/services/app-data-export.service';
import { NavigationService } from '../../core/services/navigation.service';
import { AuthProvider, AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/services/i18n.service';
import { AlertSoundService } from '../../core/services/alert-sound.service';
import { ConfirmDeleteService } from '../../core/services/confirm-delete.service';
import { HelpModalService } from '../../core/services/help-modal.service';
import { TabBarComponent, TabBarItem } from '../../shared/tab-bar/tab-bar.component';
import { AvatarIconComponent } from '../../shared/avatar-icon/avatar-icon.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import {
  BREEDS_SPRITE_COLS,
  BREEDS_SPRITE_ROWS,
  getBreedAvatarIndex,
} from '../../core/data/class-breeds.data';
import { getWakfuItemRarity } from '../../core/data/wakfu-item-rarity.data';
import { CatalogService } from '../../core/api/catalog.service';
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
import { AppPageComponent } from '../../shared/app-page/app-page.component';
import { AutoFillColumnsObserver } from '../../core/utils/auto-fill-grid-columns';
import { focusInlineEditInput } from '../../core/utils/inline-edit-focus';
import { IconComponent } from '../../shared/icon/icon.component';
import { GameServerService } from '../../core/services/game-server.service';
import { ColorblindProfile, ColorblindService } from '../../core/services/colorblind.service';

type ProfileTab = 'avatar' | 'alerts' | 'characters' | 'connection';

/** Page dédiée au profil (pseudo, avatar, alertes sonores de butin, connexion Discord/Google) —
 * voir NavigationService pour le slide d'entrée/sortie. */
@Component({
  selector: 'app-profile-page',
  imports: [
    AvatarIconComponent,
    ItemIconComponent,
    TranslatePipe,
    WakfuAutocompleteComponent,
    CharacterAddFormComponent,
    NgClass,
    AppPageComponent,
    IconComponent,
    TabBarComponent,
    NgTemplateOutlet,
  ],
  templateUrl: './profile-page.component.html',
  styleUrl: './profile-page.component.css',
})
export class ProfilePageComponent implements OnDestroy {
  protected readonly profile = inject(ProfileService);
  protected readonly i18n = inject(I18nService);
  private readonly catalog = inject(CatalogService);
  protected readonly roster = inject(CharacterRosterService);
  protected readonly gameServers = inject(GameServerService);
  protected readonly colorblind = inject(ColorblindService);
  protected readonly helpModal = inject(HelpModalService);
  protected readonly auth = inject(AuthService);
  private readonly dataExport = inject(AppDataExportService);
  private readonly nav = inject(NavigationService);
  private readonly alertSound = inject(AlertSoundService);
  private readonly confirmDelete = inject(ConfirmDeleteService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  protected readonly avatarIndexes = Array.from(
    { length: BREEDS_SPRITE_COLS * BREEDS_SPRITE_ROWS },
    (_, i) => i,
  );

  /** 4 positions du switch daltonien (voir `ColorblindService`) — libellé court affiché,
   * libellé complet en tooltip. Ordre = ordre visuel du switch. */
  protected readonly colorblindOptions: readonly {
    value: ColorblindProfile;
    labelKey: string;
    tooltipKey: string;
  }[] = [
    { value: 'off', labelKey: 'profile.colorblindOff', tooltipKey: 'profile.colorblindOff' },
    {
      value: 'protanopia',
      labelKey: 'profile.colorblindProtanopiaShort',
      tooltipKey: 'profile.colorblindProtanopia',
    },
    {
      value: 'deuteranopia',
      labelKey: 'profile.colorblindDeuteranopiaShort',
      tooltipKey: 'profile.colorblindDeuteranopia',
    },
    {
      value: 'tritanopia',
      labelKey: 'profile.colorblindTritanopiaShort',
      tooltipKey: 'profile.colorblindTritanopia',
    },
  ];

  /** Position du fond glissant du switch daltonien (4 positions, `.icon-switch-4` pose déjà la
   * largeur à 25% — voir styles.css) : calculée ici plutôt que via les classes `.is-right`/
   * `.is-far-right` génériques (pensées pour 2/3 positions, pas 4). */
  protected readonly colorblindHighlightTransform = computed(() => {
    const index = this.colorblindOptions.findIndex((o) => o.value === this.colorblind.profile());
    return `translateX(${Math.max(index, 0) * 100}%)`;
  });

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

  /** Onglets de la page profil (Avatar/Connexion/Alertes/Personnages) — voir TabBarComponent.
   * Chaque section reste montée en permanence (juste masquée via `.tab-hidden`) pour conserver son
   * état, à l'ordre `TAB_DEFS` près (source unique de vérité pour la barre d'onglets ET l'ordre
   * d'empilement desktop, voir le template). */
  private static readonly TAB_DEFS: readonly TabBarItem[] = [
    { id: 'avatar', label: 'profile.tabAvatar' },
    { id: 'connection', label: 'profile.tabConnection', helpSection: 'profileConnection' },
    { id: 'alerts', label: 'profile.tabAlerts', helpSection: 'profileAlerts' },
    { id: 'characters', label: 'profile.tabCharacters', helpSection: 'profileCharacters' },
  ];
  protected readonly tabDefs = ProfilePageComponent.TAB_DEFS;

  protected readonly activeTab = signal<ProfileTab>('avatar');

  /** Nombre de colonnes réellement affichées dans `.sound-item-grid` (grid en `auto-fill`, donc
   * variable selon la largeur disponible) — voir AutoFillColumnsObserver. Valeurs en dur = copie
   * de `.sound-item-grid` dans profile-page.component.css (`gap: 8px`, `minmax(120px, 1fr)`,
   * `padding: 2px`). */
  private readonly soundGrid = viewChild<ElementRef<HTMLDivElement>>('soundGrid');
  protected readonly soundGridColumns = new AutoFillColumnsObserver(8, 120);

  /** Même principe que `soundGridColumns` ci-dessus, pour la vue grille des personnages (voir
   * `.roster-character-list.is-grid` en CSS — valeurs à garder synchronisées). */
  private readonly charGrid = viewChild<ElementRef<HTMLDivElement>>('charGrid');
  protected readonly charGridColumns = new AutoFillColumnsObserver(8, 120);

  /** Onglet de compte actif (voir `rosterTabItems`/TabBarComponent) — signal en mémoire
   * seulement, pas persisté, comme `DashboardComponent.activeTab`. */
  protected readonly selectedAccountId = signal<string | null>(null);
  protected readonly selectedAccount = computed<RosterAccount | null>(
    () => this.roster.accounts().find((a) => a.id === this.selectedAccountId()) ?? null,
  );

  /** Items de la barre d'onglets de comptes (voir TabBarComponent) — un compte retirable (croix)
   * dès qu'il n'est pas le compte par défaut, tooltip = libellé complet (toujours affiché, pas
   * seulement en cas de troncature, comme avant). */
  protected readonly rosterTabItems = computed<TabBarItem[]>(() =>
    this.roster.accounts().map((account, i) => {
      const label = this.tabLabel(account, i);
      return {
        id: account.id,
        label,
        tooltip: label,
        removable: !account.isDefault,
        removeTooltip: 'profile.rosterRemoveAccount',
      };
    }),
  );

  constructor() {
    focusInlineEditInput(this.editingPseudo, this.pseudoEditInput);
    focusInlineEditInput(
      computed(() => this.editingCharacter() !== null),
      this.charEditInput,
    );

    effect(() => this.soundGridColumns.observe(this.soundGrid()?.nativeElement));
    effect(() => this.charGridColumns.observe(this.charGrid()?.nativeElement));

    // Consomme le flag posé par la page compte (voir NavigationService) : forcer l'onglet
    // Connexion quand on arrive ici depuis son CTA "Se connecter" (état invité).
    effect(() => {
      if (!this.nav.profileConnectionTabRequested()) return;
      this.activeTab.set('connection');
      this.nav.profileConnectionTabRequested.set(false);
    });

    // Même chose depuis le badge « serveur actif » du header (lot 7), qui renvoie ici quand aucun
    // serveur n'est renseigné nulle part.
    effect(() => {
      if (!this.nav.profileCharactersTabRequested()) return;
      this.activeTab.set('characters');
      this.nav.profileCharactersTabRequested.set(false);
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
  }

  ngOnDestroy(): void {
    this.soundGridColumns.disconnect();
    this.charGridColumns.disconnect();
  }

  protected goBack(): void {
    this.nav.pop();
  }

  /** Onglet principal sélectionné depuis la barre — `id` est bien un `ProfileTab` (voir `tabDefs`,
   * seule source des items passés à `<app-tab-bar>`), l'assertion est sûre. */
  protected selectTab(id: string): void {
    this.activeTab.set(id as ProfileTab);
  }

  /** Bouton "Gérer mon compte" de l'onglet Connexion (état authentifié uniquement) — seul point
   * d'entrée restant vers la page compte depuis que le bouton du header a été retiré (voir
   * CLAUDE.md) : sans lui, un utilisateur déjà connecté n'aurait plus aucun moyen de consulter ses
   * sessions, exporter ses données ou supprimer son compte après la redirection post-connexion. */
  protected openAccount(): void {
    this.nav.openAccount();
  }

  protected startEditPseudo(): void {
    this.editingPseudo.set(true);
  }

  /** Appelé à la fois par (blur) et par Entrée (voir onPseudoKeydown) — le garde-fou
   * `!editingPseudo()` évite qu'un blur déclenché par la fermeture du champ (Entrée déjà commitée,
   * ou Échap qui annule) ne recommite la valeur tapée : Échap doit vraiment annuler, pas juste
   * fermer le champ pendant qu'un commit résiduel s'exécute derrière. */
  protected commitPseudo(value: string): void {
    if (!this.editingPseudo()) return;
    this.profile.setPseudo(value.trim());
    this.editingPseudo.set(false);
  }

  protected onPseudoKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.commitPseudo((event.target as HTMLInputElement).value);
    } else if (event.key === 'Escape') {
      this.editingPseudo.set(false);
    }
  }

  protected chooseAvatar(index: number): void {
    this.profile.setAvatar(index);
  }

  /** Repris de l'ancienne page de connexion dédiée (voir CLAUDE.md) : nettoie une éventuelle
   * erreur d'une tentative précédente avant de relancer le flux OAuth. */
  protected login(provider: AuthProvider): void {
    this.auth.clearError();
    this.auth.login(provider);
  }

  protected onDurationInput(value: string): void {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) this.profile.setAlertDuration(seconds);
  }

  protected setManualClose(value: boolean): void {
    this.profile.setAlertManualClose(value);
  }

  protected testAlertSound(): void {
    this.alertSound.playLoot();
  }

  protected manualCloseTooltip(): string {
    if (this.profile.alertManualClose()) {
      return this.i18n.t('profile.manualCloseTooltip');
    }
    const seconds = this.profile.alertDurationSeconds();
    const key =
      seconds === 1 ? 'profile.autoCloseTooltipSingular' : 'profile.autoCloseTooltipPlural';
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
    return `rarity-${getWakfuItemRarity(this.catalog, name)}`;
  }

  protected characterIcon(char: RosterCharacter): string {
    return getClassIconUri(char.className, char.gender);
  }

  /** Tooltip JS des noms de personnage tronqués (liste et grille) — même
   * principe que `.kpi-name-tooltip` dans tracker-strip (mutualisé en
   * `.floating-name-tooltip`, styles.css) : un `[title]` classique serait
   * rogné par `overflow` de `.roster-character-scroll`. */
  protected readonly nameTooltip = signal<{ text: string; right: number; bottom: number } | null>(
    null,
  );

  protected onNameHover(nameEl: HTMLElement, name: string): void {
    if (nameEl.scrollWidth <= nameEl.clientWidth) {
      this.nameTooltip.set(null);
      return;
    }
    const hostRect = this.elementRef.nativeElement.getBoundingClientRect();
    const targetRect = nameEl.getBoundingClientRect();
    const gap = 6;
    this.nameTooltip.set({
      text: name,
      right: hostRect.right - targetRect.right - gap,
      bottom: hostRect.bottom - targetRect.top + gap,
    });
  }

  protected onNameLeave(): void {
    this.nameTooltip.set(null);
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

  protected renameAccount(id: string, value: string): void {
    this.roster.renameAccount(id, value);
  }

  /** `''` (option « non renseigné ») ne devient jamais une chaîne vide en base : voir
   * `RosterAccount.gameServer`, absence = non renseigné. */
  protected setAccountServer(accountId: string, code: string): void {
    this.roster.setAccountGameServer(accountId, code || null);
  }

  protected selectAccount(id: string): void {
    this.selectedAccountId.set(id);
  }

  /** Libellé affiché sur l'onglet : "Principal" pour le compte par défaut
   * (non renommable), le libellé choisi sinon, ou un nom générique tant
   * qu'il n'a pas encore été renseigné. */
  protected tabLabel(account: RosterAccount, index: number): string {
    if (account.isDefault) return this.i18n.t('profile.rosterDefaultAccountLabel');
    return (
      account.label.trim() || this.i18n.t('profile.rosterUnnamedAccount', { index: index + 1 })
    );
  }

  /** Pas de pluralisation ICU dans cette app (voir CLAUDE.md) : clé singulier/pluriel distincte selon le nombre de personnages du compte affiché. */
  protected characterCountLabel(count: number): string {
    const key =
      count === 1 ? 'profile.rosterCharacterCountOne' : 'profile.rosterCharacterCountMany';
    return this.i18n.t(key, { n: count });
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

  /** Appelé à la fois par (blur) et par Entrée (voir onCharacterRenameKeydown) — le garde-fou
   * `isEditingCharacter` évite qu'un blur déclenché par la fermeture du champ (Entrée déjà
   * commitée, ou Échap qui annule) ne recommite la valeur tapée : Échap doit vraiment annuler, pas
   * juste fermer le champ pendant qu'un commit résiduel s'exécute derrière. */
  protected commitCharacterRename(accountId: string, oldName: string, value: string): void {
    if (!this.isEditingCharacter(accountId, oldName)) return;
    const trimmed = value.trim();
    if (trimmed && trimmed !== oldName) this.roster.renameCharacter(accountId, oldName, trimmed);
    this.editingCharacter.set(null);
  }

  protected onCharacterRenameKeydown(
    event: KeyboardEvent,
    accountId: string,
    oldName: string,
  ): void {
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

  /** Un import réécrit l'ensemble des données utilisateur (voir
   * AppDataExportService) : recharger la page est le moyen le plus sûr de
   * refléter le résultat partout (chaque service/composant se réinitialise
   * proprement depuis les nouvelles valeurs, sans risquer d'oublier de
   * resynchroniser un signal en mémoire quelque part). L'`await` n'est pas
   * décoratif : en mode connecté, il laisse l'import partir vers le compte
   * avant que le rechargement n'interrompe l'écriture décalée. */
  protected async onImportFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      await this.dataExport.applyImport(raw);
      window.location.reload();
    } catch {
      window.alert(this.i18n.t('profile.importError'));
    }
  }
}
