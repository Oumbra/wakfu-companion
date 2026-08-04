import { Component, inject, OnInit } from '@angular/core';
import { LogFileAccessService } from './core/services/log-file-access.service';
import { StatsStoreService } from './core/services/stats-store.service';
import { I18nService } from './core/services/i18n.service';
import { NavigationService } from './core/services/navigation.service';
import { SetupComponent } from './features/setup/setup.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { SessionRecapComponent } from './features/session-recap/session-recap.component';
import { ProfilePageComponent } from './features/profile-page/profile-page.component';
import { LootAlertComponent } from './features/loot-alert/loot-alert.component';
import { ClassPickerComponent } from './shared/class-picker/class-picker.component';
import { ClassPickerService } from './core/services/class-picker.service';
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
  protected readonly combatPanel = inject(CombatPanelService);
  // Injecté ici pour garantir que le store écoute newLines$ dès le démarrage.
  private readonly stats = inject(StatsStoreService);

  ngOnInit(): void {
    void this.logFileAccess.init();
  }

  protected onClassChosen(event: { className: string; gender: Gender }): void {
    this.classPickerService.request()?.onChosen(event.className, event.gender);
    this.classPickerService.close();
  }
}
