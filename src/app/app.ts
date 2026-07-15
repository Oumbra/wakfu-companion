import { Component, inject, OnInit } from '@angular/core';
import { LogFileAccessService } from './core/services/log-file-access.service';
import { StatsStoreService } from './core/services/stats-store.service';
import { SetupComponent } from './features/setup/setup.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { SessionRecapComponent } from './features/session-recap/session-recap.component';

@Component({
  selector: 'app-root',
  imports: [SetupComponent, DashboardComponent, SessionRecapComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  protected readonly logFileAccess = inject(LogFileAccessService);
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
}
