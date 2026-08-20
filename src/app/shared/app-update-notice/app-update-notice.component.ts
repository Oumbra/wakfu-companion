import { Component, inject } from '@angular/core';
import { AppUpdateService } from '../../core/services/app-update.service';
import { TranslatePipe } from '../translate.pipe';

/**
 * Bannière discrète affichée quand AppUpdateService détecte une nouvelle version déployée
 * (service worker Angular, VERSION_READY) — laisse l'utilisateur choisir le moment du reload
 * plutôt que de le forcer, voir AppUpdateService.
 */
@Component({
  selector: 'app-update-notice',
  imports: [TranslatePipe],
  templateUrl: './app-update-notice.component.html',
  styleUrl: './app-update-notice.component.css',
})
export class AppUpdateNoticeComponent {
  protected readonly updateService = inject(AppUpdateService);

  protected reload(): void {
    this.updateService.reload();
  }

  protected dismiss(): void {
    this.updateService.updateReady.set(false);
  }
}
