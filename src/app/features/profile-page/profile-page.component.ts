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
import { CharacterViewMode, ProfileService } from '../../core/services/profile.service';
import { PersistenceService } from '../../core/services/persistence.service';
import { AppDataExportService } from '../../core/services/app-data-export.service';
import { NavigationService } from '../../core/services/navigation.service';
import { AuthProvider, AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/services/i18n.service';
import { AlertSoundService } from '../../core/services/alert-sound.service';
import { ConfirmDeleteService } from '../../core/services/confirm-delete.service';
import { HelpModalService } from '../../core/services/help-modal.service';
import { TabBarComponent, TabBarItem } from '../../shared/tab-bar/tab-bar.component';
import { AvatarIconComponent } from '../../shared/avatar-icon/avatar-icon.component';
import { ClassPortraitComponent } from '../../shared/class-portrait/class-portrait.component';
import { ItemIconComponent } from '../../shared/item-icon/item-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { getBreedAvatarIndex } from '../../core/data/class-breeds.data';
import { AVATAR_GRID_ENTRIES } from '../../core/data/class-portraits.data';
import { getWakfuItemRarity } from '../../core/data/wakfu-item-rarity.data';
import { CatalogService } from '../../core/api/catalog.service';
import { WakfuAutocompleteComponent } from '../../shared/wakfu-autocomplete/wakfu-autocomplete.component';
import { WakfuSearchResult } from '../../core/services/wakfu-search.service';
import {
  CharacterRosterService,
  RosterAccount,
  RosterCharacter,
} from '../../core/services/character-roster.service';
import { Gender, getClassIconUri } from '../../core/data/class-icons.data';
import { getClassName } from '../../core/data/class-names.data';
import {
  CharacterAddFormComponent,
  NewRosterCharacter,
} from './character-add-form/character-add-form.component';
import { AppPageComponent } from '../../shared/app-page/app-page.component';
import { AutoFillColumnsObserver } from '../../core/utils/auto-fill-grid-columns';
import { MediaQuerySignal } from '../../core/utils/media-query-signal';
import { IconComponent } from '../../shared/icon/icon.component';
import { GameServerService } from '../../core/services/game-server.service';
import { ColorblindProfile, ColorblindService } from '../../core/services/colorblind.service';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { EditableNameComponent } from '../../shared/editable-name/editable-name.component';

type ProfileTab = 'avatar' | 'colorblind' | 'alerts' | 'characters' | 'connection';

interface ColorblindSwatch {
  labelKey: string;
  before: string;
  after: string;
}

/** Une entrée par couleur RÉELLEMENT redéfinie pour ce profil (voir les blocs
 * `[data-colorblind='...']` de styles.css, à garder synchronisé avec cette liste) — ce qui permet
 * à l'utilisateur de voir en un coup d'œil, avant/après, tout ce que le profil choisi va changer
 * dans l'app, sans avoir à chercher ces éléments un par un dans l'interface. */
const COLORBLIND_SWATCHES: Record<Exclude<ColorblindProfile, 'off'>, ColorblindSwatch[]> = {
  // Protanopie et deutéranopie sont mutualisées sous une seule option ('redGreen') : même axe de
  // confusion rouge-vert, donc même correction pour les deux — voir ColorblindService.
  redGreen: [
    { labelKey: 'damageMeter.won', before: '#2ecc71', after: '#3391ff' },
    { labelKey: 'damageMeter.lost', before: '#e74c3c', after: '#e6863c' },
    { labelKey: 'profile.colorblindSwatchEarth', before: '#1b8045', after: '#0f6b8c' },
    { labelKey: 'chat.channel.recrutement', before: '#2ecc71', after: '#3391ff' },
    { labelKey: 'profile.colorblindSwatchRare', before: '#1dd15f', after: '#17b8a0' },
    { labelKey: 'profile.colorblindSwatchLegendary', before: '#c7d400', after: '#e0c200' },
  ],
  tritanopia: [
    { labelKey: 'profile.colorblindSwatchWater', before: '#00e1ff', after: '#1f9fd9' },
    { labelKey: 'profile.colorblindSwatchLight', before: '#ffd700', after: '#ffb703' },
    { labelKey: 'chat.channel.commerce', before: '#ffd700', after: '#ffb703' },
  ],
};

/** Page dédiée au profil (pseudo, avatar, alertes sonores de butin, connexion Discord/Google) —
 * voir NavigationService pour le slide d'entrée/sortie. */
@Component({
  selector: 'app-profile-page',
  imports: [
    AvatarIconComponent,
    ClassPortraitComponent,
    ItemIconComponent,
    TranslatePipe,
    WakfuAutocompleteComponent,
    CharacterAddFormComponent,
    NgClass,
    AppPageComponent,
    IconComponent,
    TabBarComponent,
    NgTemplateOutlet,
    TooltipDirective,
    EditableNameComponent,
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
  private readonly persistence = inject(PersistenceService);

  /** Seuil mobile réactif (même 800px que `.mobile-only`/`@media` un peu partout côté CSS) — sert
   * uniquement là où le template a besoin de brancher sur ce seuil en JS, pas juste d'un
   * `display:none/flex` pur CSS (voir `effectiveCharacterViewMode` ci-dessous). */
  protected readonly isMobile = new MediaQuerySignal('(max-width: 800px)');

  /** Cases de la grille "Avatar" (18 classes x 2 sexes, voir class-portraits.data.ts) — l'index
   * dans ce tableau EST `profile.avatarIndex()` (schéma v5, voir ProfileService). */
  protected readonly avatarGridEntries = AVATAR_GRID_ENTRIES;

  /** 3 positions du switch daltonien (voir `ColorblindService`) — libellé court affiché, libellé
   * complet en tooltip. Ordre = ordre visuel du switch ; `.icon-switch-3` générique de styles.css
   * suffit désormais (fond glissant en `.is-right`/`.is-far-right`, plus besoin d'un calcul JS
   * depuis la fusion protanopie/deutéranopie en une seule option). */
  protected readonly colorblindOptions: readonly {
    value: ColorblindProfile;
    labelKey: string;
    tooltipKey: string;
  }[] = [
    { value: 'off', labelKey: 'profile.colorblindOff', tooltipKey: 'profile.colorblindOff' },
    {
      value: 'redGreen',
      labelKey: 'profile.colorblindRedGreenShort',
      tooltipKey: 'profile.colorblindRedGreen',
    },
    {
      value: 'tritanopia',
      labelKey: 'profile.colorblindTritanopiaShort',
      tooltipKey: 'profile.colorblindTritanopia',
    },
  ];

  /** Aperçu avant/après des couleurs réellement affectées par le profil actuellement sélectionné —
   * vide pour 'off' (rien n'est masqué, `[class.hidden]`/`@if` côté template). */
  protected readonly colorblindSwatches = computed<ColorblindSwatch[]>(() => {
    const profile = this.colorblind.profile();
    return profile === 'off' ? [] : COLORBLIND_SWATCHES[profile];
  });

  protected readonly existingSoundItemNames = computed(() =>
    this.profile
      .soundItems()
      .map((entry) => ({ name: entry.name, kind: 'item' as const, id: entry.catalogId })),
  );

  /** Tous comptes confondus — affiché à côté de l'onglet "Personnages" du rail (voir CLAUDE.md,
   * proposition A). */
  protected readonly totalCharacterCount = computed(() =>
    this.roster.accounts().reduce((sum, account) => sum + account.characters.length, 0),
  );

  /** Vue de `.roster-character-list` réellement affichée : `profile.characterViewMode()` (voir
   * ProfileService) reste la préférence mémorisée/synchronisée, modifiable seulement depuis le
   * switch mobile (`.icon-switch.mobile-only`) — mais le desktop l'ignore et affiche TOUJOURS la
   * grille, quel que soit le dernier choix fait sur mobile. En repassant en mobile, c'est bien ce
   * dernier choix qui reprend la main (pas de valeur distincte stockée pour le mode desktop). */
  protected readonly effectiveCharacterViewMode = computed<CharacterViewMode>(() =>
    this.isMobile.matches() ? this.profile.characterViewMode() : 'grid',
  );

  private charDragIndex: number | null = null;

  /** Onglets de la page profil (Avatar/Connexion/Alertes/Personnages) — voir TabBarComponent.
   * Chaque section reste montée en permanence (juste masquée via `.tab-hidden`) pour conserver son
   * état, à l'ordre `TAB_DEFS` près (source unique de vérité pour la barre d'onglets ET l'ordre
   * d'empilement desktop, voir le template). */
  private static readonly TAB_DEFS: readonly TabBarItem[] = [
    { id: 'avatar', label: 'profile.railIdentity' },
    { id: 'colorblind', label: 'profile.railAccessibility' },
    { id: 'connection', label: 'profile.tabConnection' },
    { id: 'alerts', label: 'profile.railSoundAlerts' },
    { id: 'characters', label: 'profile.tabCharacters' },
  ];
  protected readonly tabDefs = ProfilePageComponent.TAB_DEFS;

  protected readonly activeTab = signal<ProfileTab>('avatar');

  /** Repli desktop des 2 rails de navigation (`.profile-rail` principal ET `.roster-account-rail`,
   * voir icône `.profile-rail-collapse-toggle` en bas de chacun) — préférence purement locale
   * (device courant), pas un des 6 domaines synchronisés (voir CLAUDE.md) : même mécanisme que
   * `CombatPanelService.collapsed` (PersistenceService direct, pas ProfileService/UserDataService).
   * Deux clés indépendantes : rien n'oblige les deux rails à être repliés ensemble. */
  private static readonly NAV_RAIL_COLLAPSED_KEY = 'wakfu-profile-nav-rail-collapsed';
  private static readonly ROSTER_RAIL_COLLAPSED_KEY = 'wakfu-profile-roster-rail-collapsed';

  protected readonly isNavRailCollapsed = signal<boolean>(
    this.persistence.getJson<boolean>(ProfilePageComponent.NAV_RAIL_COLLAPSED_KEY) ?? false,
  );
  protected readonly isRosterRailCollapsed = signal<boolean>(
    this.persistence.getJson<boolean>(ProfilePageComponent.ROSTER_RAIL_COLLAPSED_KEY) ?? false,
  );

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

  /** Formulaire inline "Ajouter un personnage" (desktop) — replié par défaut, voir
   * `character-add-collapse` dans le template/CSS. Un seul compte est affiché à la fois donc un
   * simple booléen suffit (pas besoin de le clé sur l'id du compte). */
  protected readonly addCharacterFormOpen = signal(false);
  /** Hauteur réelle du contenu du formulaire, mesurée via ResizeObserver plutôt qu'une animation
   * CSS `grid-template-rows: 0fr -> 1fr` (technique essayée d'abord, mais empiriquement peu fiable
   * pour la fermeture : reste bloquée à la hauteur ouverte dans certains moteurs — vérifié en
   * session). Une transition `height` en px, elle, est universellement supportée. Mesuré même
   * replié (l'élément observé n'est pas retiré du DOM, seul un ancêtre le clippe visuellement à 0),
   * donc la 1ère ouverture connaît déjà la bonne hauteur sans à-coup. */
  private readonly characterAddPanelInner = viewChild<ElementRef<HTMLDivElement>>(
    'characterAddPanelInner',
  );
  protected readonly characterAddPanelHeight = signal(0);
  private characterAddPanelResizeObserver?: ResizeObserver;

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
    effect(() => this.soundGridColumns.observe(this.soundGrid()?.nativeElement));
    effect(() => this.charGridColumns.observe(this.charGrid()?.nativeElement));

    effect(() => {
      const el = this.characterAddPanelInner()?.nativeElement;
      this.characterAddPanelResizeObserver?.disconnect();
      if (!el) return;
      this.characterAddPanelResizeObserver = new ResizeObserver(() => {
        this.characterAddPanelHeight.set(el.scrollHeight);
      });
      this.characterAddPanelResizeObserver.observe(el);
      this.characterAddPanelHeight.set(el.scrollHeight);
    });

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
    this.characterAddPanelResizeObserver?.disconnect();
    this.isMobile.disconnect();
  }

  protected goBack(): void {
    this.nav.pop();
  }

  /** Onglet principal sélectionné depuis la barre — `id` est bien un `ProfileTab` (voir `tabDefs`,
   * seule source des items passés à `<app-tab-bar>`), l'assertion est sûre. */
  protected selectTab(id: string): void {
    this.activeTab.set(id as ProfileTab);
  }

  protected toggleNavRailCollapsed(): void {
    const next = !this.isNavRailCollapsed();
    this.isNavRailCollapsed.set(next);
    this.persistence.setJson(ProfilePageComponent.NAV_RAIL_COLLAPSED_KEY, next);
  }

  protected toggleRosterRailCollapsed(): void {
    const next = !this.isRosterRailCollapsed();
    this.isRosterRailCollapsed.set(next);
    this.persistence.setJson(ProfilePageComponent.ROSTER_RAIL_COLLAPSED_KEY, next);
  }

  /** Libellé texte d'un bouton du rail principal — même logique que le `@switch` du template (voir
   * `.profile-rail-label`), dupliquée ici sous forme de chaîne pour alimenter le `[attr.data-tooltip]`
   * affiché quand le rail est replié (l'élément `<span class="profile-rail-label">` correspondant
   * est alors masqué en CSS, donc inutilisable comme source de tooltip natif). */
  protected railButtonLabel(tabId: string): string {
    switch (tabId) {
      case 'avatar':
        return this.i18n.t('profile.railIdentity');
      case 'colorblind':
        return this.i18n.t('profile.railAccessibility');
      case 'alerts':
        return this.i18n.t('profile.railSoundAlerts');
      default: {
        const tab = this.tabDefs.find((t) => t.id === tabId);
        return tab ? this.i18n.t(tab.label) : '';
      }
    }
  }

  /** Bouton "Gérer mon compte" de l'onglet Connexion (état authentifié uniquement) — seul point
   * d'entrée restant vers la page compte depuis que le bouton du header a été retiré (voir
   * CLAUDE.md) : sans lui, un utilisateur déjà connecté n'aurait plus aucun moyen de consulter ses
   * sessions, exporter ses données ou supprimer son compte après la redirection post-connexion. */
  protected openAccount(): void {
    this.nav.openAccount();
  }

  /** Voir EditableNameComponent (`(renamed)`) — appelé avec la valeur brute saisie, le trim/le
   * rejet éventuel restent de la responsabilité de l'appelant (ici : accepter une valeur vide,
   * pour effacer le pseudo). */
  protected commitPseudo(value: string): void {
    this.profile.setPseudo(value.trim());
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

  /** Tooltip de l'option "Auto" du switch de fermeture (voir CLAUDE.md) — dépend de la durée
   * réglée, contrairement à celui de "Manuelle" (texte fixe, posé directement dans le template). */
  protected autoCloseTooltip(): string {
    const seconds = this.profile.alertDurationSeconds();
    const key =
      seconds === 1 ? 'profile.autoCloseTooltipSingular' : 'profile.autoCloseTooltipPlural';
    return this.i18n.t(key, { seconds });
  }

  protected addSoundItem(result: WakfuSearchResult): void {
    this.profile.addSoundItem(result.name, result.id);
  }

  protected toggleSound(name: string, catalogId: number | null): void {
    this.profile.toggleSoundItem(name, catalogId);
  }

  /** Suppression confirmée via la même popover partagée que le reste (voir ConfirmDeleteService) —
   * réutilise `tracker.confirmDelete` ("Retirer ?"), déjà utilisé pour le retrait des KPI de suivi. */
  protected requestRemoveSoundItem(event: Event, name: string, catalogId: number | null): void {
    event.stopPropagation();
    const button = event.currentTarget as HTMLElement;
    this.confirmDelete.open(button, this.i18n.t('tracker.confirmDelete'), () => {
      this.profile.removeSoundItem(name, catalogId);
    });
  }

  protected rarityClass(name: string, catalogId: number | null): string {
    return `rarity-${getWakfuItemRarity(this.catalog, name, catalogId)}`;
  }

  protected characterIcon(char: RosterCharacter): string {
    return getClassIconUri(char.className, char.gender);
  }

  /** Nom de classe localisé (voir class-names.data.ts) — la clé interne (`char.className`, proche
   * de l'anglais) n'est pas affichable telle quelle, plusieurs classes ayant un nom radicalement
   * différent selon la langue. */
  protected characterClassName(char: RosterCharacter): string {
    return getClassName(char.className, this.i18n.locale());
  }

  /** Libellé de la tuile de la grille "Avatar" (tooltip au survol, voir class-portrait.component). */
  protected avatarEntryLabel(entry: { className: string; gender: Gender }): string {
    return getClassName(entry.className, this.i18n.locale());
  }

  /** Portrait utilisé uniquement en vue grille (voir `.roster-character-avatar`) — même planche que le sélecteur d'avatar, plus flatteuse que les icônes de classe de la vue liste. */
  protected avatarIndexForChar(char: RosterCharacter): number {
    return getBreedAvatarIndex(char.className, char.gender);
  }

  protected addAccount(): void {
    const id = this.roster.addAccount();
    this.selectedAccountId.set(id);
  }

  /** Suppression confirmée via la même popover partagée que le reste (voir ConfirmDeleteService,
   * même schéma que `requestRemoveCharacter`) — `event.currentTarget` sert d'ancre, que l'appel
   * vienne d'un clic direct sur la croix (en-tête de compte) ou du `remove` de TabBarComponent
   * (onglet actif du roster en mobile), qui réémet l'event d'origine pour ce même usage. */
  protected requestRemoveAccount(event: Event, id: string): void {
    event.stopPropagation();
    const button = event.currentTarget as HTMLElement;
    this.confirmDelete.open(button, this.i18n.t('profile.confirmRemoveAccount'), () => {
      this.roster.removeAccount(id);
    });
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
    this.addCharacterFormOpen.set(false);
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

  /** Referme aussi le formulaire desktop après ajout (`addCharacterFormOpen`) — sans effet côté
   * mobile, où le formulaire reste de toute façon en permanence affiché. */
  protected addCharacterFromForm(accountId: string, character: NewRosterCharacter): void {
    this.roster.addCharacter(accountId, character.name, character.className, character.gender);
    this.addCharacterFormOpen.set(false);
  }

  /** Bouton "Ajouter un personnage" desktop : déplie/replie le formulaire inline juste en dessous
   * (voir `character-add-collapse` dans le template/CSS) — remplace l'ancienne modale centrée. */
  protected toggleAddCharacterForm(): void {
    this.addCharacterFormOpen.update((open) => !open);
  }

  /** Voir EditableNameComponent (`(renamed)`) — `CharacterRosterService.renameCharacter` gère
   * déjà lui-même le trim et le rejet d'une valeur vide/inchangée. */
  protected renameCharacter(accountId: string, oldName: string, value: string): void {
    this.roster.renameCharacter(accountId, oldName, value);
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
