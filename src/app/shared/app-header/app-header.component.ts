import { Component, inject, signal } from '@angular/core';
import { LogFileAccessService } from '../../core/services/log-file-access.service';
import { StatsStoreService } from '../../core/services/stats-store.service';
import { NavigationService } from '../../core/services/navigation.service';
import { SessionRecapService } from '../../core/services/session-recap.service';
import { LanguageSwitcherComponent } from '../language-switcher/language-switcher.component';
import { TranslatePipe } from '../translate.pipe';
import { APP_LOGO_PURPLE_DATA_URI } from '../../core/data/app-logo.data';
import { SESSION_RECAP_ICON_DATA_URI } from '../../core/data/session-recap-icon.data';
import { ProfileComponent } from '../../features/profile/profile.component';

/**
 * En-tête du site (logo, titre, fichier connecté + actions changer/réinitialiser, langue, recap de
 * session, accès profil) — rendu une seule fois au niveau racine (voir app.html), commun à toutes
 * les pages. En dessous de 640px, recap/langue/profil se regroupent dans un menu burger (même
 * principe que `.mobile-menu` ailleurs dans l'app) car ils ne tiennent plus sur une seule ligne à
 * côté du logo/titre/fichier.
 *
 * Recap et profil ne s'affichent que si un fichier wakfu.log valide est connecté ; le bouton
 * profil s'efface en plus sur la page profil elle-même (pas de bouton pour aller vers la page où
 * l'on se trouve déjà).
 */
@Component({
  selector: 'app-header',
  imports: [LanguageSwitcherComponent, TranslatePipe, ProfileComponent],
  templateUrl: './app-header.component.html',
  styleUrl: './app-header.component.css',
})
export class AppHeaderComponent {
  protected readonly logFileAccess = inject(LogFileAccessService);
  protected readonly nav = inject(NavigationService);
  protected readonly sessionRecapService = inject(SessionRecapService);
  private readonly stats = inject(StatsStoreService);
  protected readonly appLogo = APP_LOGO_PURPLE_DATA_URI;
  protected readonly sessionRecapIcon = SESSION_RECAP_ICON_DATA_URI;
  protected readonly mobileMenuOpen = signal(false);

  protected onChangeFile(): void {
    void this.logFileAccess.forgetFile();
  }

  protected onReset(): void {
    this.stats.resetStats();
  }

  protected toggleMobileMenu(): void {
    this.mobileMenuOpen.update((v) => !v);
  }

  protected closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }
}
