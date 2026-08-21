import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LogFileAccessService } from './core/services/log-file-access.service';
import { RouteSyncService } from './core/services/route-sync.service';
import { SeoService } from './core/services/seo.service';
import { PurchaseRecord, StatsStoreService } from './core/services/stats-store.service';
import { I18nService } from './core/services/i18n.service';
import { CatalogService } from './core/api/catalog.service';
import { NavigationService } from './core/services/navigation.service';
import { SetupComponent } from './features/setup/setup.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { SessionRecapComponent } from './features/session-recap/session-recap.component';
import { ProfilePageComponent } from './features/profile-page/profile-page.component';
import { LootAlertComponent } from './features/loot-alert/loot-alert.component';
import { ClassPickerComponent } from './shared/class-picker/class-picker.component';
import { ClassPickerService } from './core/services/class-picker.service';
import { DamageReassignPickerComponent } from './shared/damage-reassign-picker/damage-reassign-picker.component';
import {
  DamageReassignEntity,
  DamageReassignService,
} from './core/services/damage-reassign.service';
import { ItemPickerComponent } from './shared/item-picker/item-picker.component';
import { ItemPickerService } from './core/services/item-picker.service';
import { PurchaseReassignPickerComponent } from './shared/purchase-reassign-picker/purchase-reassign-picker.component';
import { PurchaseReassignService } from './core/services/purchase-reassign.service';
import { ConfirmDeletePopoverComponent } from './shared/confirm-delete-popover/confirm-delete-popover.component';
import { HelpModalComponent } from './shared/help-modal/help-modal.component';
import { RecipeQuantityModalComponent } from './shared/recipe-quantity-modal/recipe-quantity-modal.component';
import { LegalPageComponent } from './shared/legal-page/legal-page.component';
import { AppHeaderComponent } from './shared/app-header/app-header.component';
import { AppPageComponent } from './shared/app-page/app-page.component';
import { AccountPageComponent } from './features/auth/account-page/account-page.component';
import { TabSheetComponent } from './shared/tab-sheet/tab-sheet.component';
import { AuthService } from './core/auth/auth.service';
import { GameServerService } from './core/services/game-server.service';
import { Gender } from './core/data/class-icons.data';
import { TooltipComponent } from './shared/tooltip/tooltip.component';
import { LoadingOverlayComponent } from './shared/loading-overlay/loading-overlay.component';
import { OnboardingTourComponent } from './shared/onboarding-tour/onboarding-tour.component';
import { OnboardingHelpMenuComponent } from './shared/onboarding-help-menu/onboarding-help-menu.component';
import { OnboardingTourService } from './core/services/onboarding-tour.service';
import { AppUpdateService } from './core/services/app-update.service';
import { AppUpdateNoticeComponent } from './shared/app-update-notice/app-update-notice.component';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    SetupComponent,
    DashboardComponent,
    SessionRecapComponent,
    ProfilePageComponent,
    LootAlertComponent,
    ClassPickerComponent,
    DamageReassignPickerComponent,
    ItemPickerComponent,
    PurchaseReassignPickerComponent,
    ConfirmDeletePopoverComponent,
    HelpModalComponent,
    RecipeQuantityModalComponent,
    LegalPageComponent,
    AppHeaderComponent,
    AppPageComponent,
    AccountPageComponent,
    TabSheetComponent,
    TooltipComponent,
    LoadingOverlayComponent,
    OnboardingTourComponent,
    OnboardingHelpMenuComponent,
    AppUpdateNoticeComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  protected readonly logFileAccess = inject(LogFileAccessService);
  protected readonly i18n = inject(I18nService);
  protected readonly nav = inject(NavigationService);
  protected readonly classPickerService = inject(ClassPickerService);
  protected readonly damageReassignService = inject(DamageReassignService);
  protected readonly itemPickerService = inject(ItemPickerService);
  protected readonly purchaseReassignService = inject(PurchaseReassignService);
  // Injecté ici pour garantir que le store écoute newLines$ dès le démarrage.
  private readonly stats = inject(StatsStoreService);
  // Idem : démarre la synchronisation état de navigation → URL dès le premier changement de vue
  // (voir RouteSyncService).
  private readonly routeSync = inject(RouteSyncService);
  // Idem : démarre la mise à jour du titre d'onglet/meta description dès le premier changement de
  // vue/locale (voir SeoService).
  private readonly seo = inject(SeoService);
  private readonly catalog = inject(CatalogService);
  private readonly auth = inject(AuthService);
  private readonly gameServers = inject(GameServerService);
  // Idem : démarre l'effet de déclenchement automatique du pas-à-pas d'onboarding dès le démarrage
  // (voir OnboardingTourService), indépendamment de tout composant qui l'affiche effectivement.
  private readonly onboardingTour = inject(OnboardingTourService);
  // Idem : démarre l'écoute des mises à jour du service worker dès le démarrage (voir
  // AppUpdateService), indépendamment du rendu de <app-update-notice>.
  private readonly appUpdate = inject(AppUpdateService);

  ngOnInit(): void {
    void this.logFileAccess.init();
    // Chargement du catalogue Ankama (objets/monstres/donjons) — voir
    // core/api/catalog.service.ts. Lot 3.1 étape 3 : appelé dès maintenant
    // (et pas seulement à l'étape 7/état de démarrage explicite) car les
    // premiers consommateurs migrés (icônes, i18n, classification) ont
    // besoin de données réelles pour fonctionner. L'étape 7 ajoutera un état
    // UI explicite pour le cas `unavailable` ; en attendant, `status()` reste
    // consultable par tout composant qui en a besoin.
    void this.catalog.initialize();

    // Liste des serveurs de jeu (lot 7) — jamais compilée en dur côté client.
    // Non bloquant : sans elle, seul le sélecteur se retrouve sans options,
    // un serveur déjà choisi reste affiché (voir GameServerService).
    void this.gameServers.initialize();

    // Authentification (lot 5) : lit le retour OAuth éventuel puis interroge
    // /auth/me. Volontairement non bloquant — un invité (cas courant) ne subit
    // qu'un 401, et l'application s'affiche normalement pendant ce temps.
    void this.auth.handleStartup().then((outcome) => {
      // Consommé dès qu'un retour OAuth existe (succès OU échec) — pas seulement en cas de
      // succès : sinon un login annulé/en erreur laisserait le flag traîner en sessionStorage et
      // fausserait la toute PROCHAINE connexion réussie dans ce même onglet (ex. depuis la page
      // profil), qui n'a plus rien à voir avec le bouton mobile "passer cette étape".
      const mobileSkipPending = outcome ? this.auth.consumeMobileSkipLoginPending() : false;
      if (outcome?.status !== 'ok') return;
      // Retour du bouton mobile "passer cette étape" (voir SetupComponent/
      // LogFileAccessService.simulateConnected) : la connexion vient d'aboutir pour cette seule
      // raison, direction le tableau de bord plutôt que la page compte — SAUF si une décision sur
      // les données locales est en attente (voir AuthService.evaluateDataMigration, appelé juste
      // avant ce `.then`) : cette décision ne doit jamais être prise en silence, elle reste
      // affichée sur la page compte comme pour toute autre connexion.
      if (mobileSkipPending && !this.auth.migrationPrompt()) {
        this.logFileAccess.simulateConnected(this.i18n.t('setup.mobileSkip.simulatedFileName'));
        return;
      }
      // Au retour d'une connexion réussie, on atterrit sur la page compte :
      // c'est là que se prend, le cas échéant, la décision sur les données
      // locales (voir AuthService.evaluateDataMigration).
      this.nav.openAccount();
    });
  }

  protected onClassChosen(event: { className: string; gender: Gender }): void {
    this.classPickerService.request()?.onChosen(event.className, event.gender);
    this.classPickerService.close();
  }

  protected onDamageReassignChosen(to: DamageReassignEntity): void {
    this.damageReassignService.request()?.onChosen(to);
    this.damageReassignService.close();
  }

  protected onItemChosen(event: { id: number; quantity: number }): void {
    this.itemPickerService.request()?.onChosen?.(event.id, event.quantity);
    this.itemPickerService.close();
  }

  protected onPurchaseRecordsChosen(event: {
    records: readonly PurchaseRecord[];
    catalogId: number;
  }): void {
    this.purchaseReassignService.request()?.onChosen(event.records, event.catalogId);
    this.purchaseReassignService.close();
  }
}
