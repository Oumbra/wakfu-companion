import { Component, inject, OnInit } from '@angular/core';
import { LogFileAccessService } from './core/services/log-file-access.service';
import { StatsStoreService } from './core/services/stats-store.service';
import { I18nService } from './core/services/i18n.service';
import { SetupComponent } from './features/setup/setup.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { SessionRecapComponent } from './features/session-recap/session-recap.component';
import { LanguageSwitcherComponent } from './shared/language-switcher/language-switcher.component';
import { ProfileComponent } from './features/profile/profile.component';
import { LootAlertComponent } from './features/loot-alert/loot-alert.component';
import { TranslatePipe } from './shared/translate.pipe';

@Component({
  selector: 'app-root',
  imports: [
    SetupComponent,
    DashboardComponent,
    SessionRecapComponent,
    LanguageSwitcherComponent,
    ProfileComponent,
    LootAlertComponent,
    TranslatePipe,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  protected readonly logFileAccess = inject(LogFileAccessService);
  protected readonly i18n = inject(I18nService);
  // Injecté ici pour garantir que le store écoute newLines$ dès le démarrage.
  private readonly stats = inject(StatsStoreService);

  ngOnInit(): void {
    void this.logFileAccess.init();
  }

  protected onReset(): void {
    this.stats.resetStats();
  }

  protected onChangeFile(): void {
    void this.logFileAccess.forgetFile();
  }

  protected onClassicRefreshSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.logFileAccess.pickFileClassic(file);
  }
}
