import { Component, inject, OnInit } from '@angular/core';
import { LogFileAccessService } from './core/services/log-file-access.service';
import { StatsStoreService } from './core/services/stats-store.service';
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
import { ConfirmDeletePopoverComponent } from './shared/confirm-delete-popover/confirm-delete-popover.component';
import { CombatEdgeTabComponent } from './shared/combat-edge-tab/combat-edge-tab.component';
import { CombatPanelService } from './core/services/combat-panel.service';
import { HelpModalComponent } from './shared/help-modal/help-modal.component';
import { RecipeQuantityModalComponent } from './shared/recipe-quantity-modal/recipe-quantity-modal.component';
import { LegalPageComponent } from './shared/legal-page/legal-page.component';
import { AppHeaderComponent } from './shared/app-header/app-header.component';
import { AppPageComponent } from './shared/app-page/app-page.component';
import { Gender } from './core/data/class-icons.data';

@Component({
  selector: 'app-root',
  imports: [
    SetupComponent,
    DashboardComponent,
    SessionRecapComponent,
    ProfilePageComponent,
    LootAlertComponent,
    ClassPickerComponent,
    DamageReassignPickerComponent,
    ConfirmDeletePopoverComponent,
    CombatEdgeTabComponent,
    HelpModalComponent,
    RecipeQuantityModalComponent,
    LegalPageComponent,
    AppHeaderComponent,
    AppPageComponent,
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
  protected readonly combatPanel = inject(CombatPanelService);
  // Injecté ici pour garantir que le store écoute newLines$ dès le démarrage.
  private readonly stats = inject(StatsStoreService);
  private readonly catalog = inject(CatalogService);

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
  }

  protected onClassChosen(event: { className: string; gender: Gender }): void {
    this.classPickerService.request()?.onChosen(event.className, event.gender);
    this.classPickerService.close();
  }

  protected onDamageReassignChosen(to: DamageReassignEntity): void {
    this.damageReassignService.request()?.onChosen(to);
    this.damageReassignService.close();
  }
}
