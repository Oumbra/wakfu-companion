import { Component, computed, inject, signal } from '@angular/core';
import { LogFileAccessService } from '../../core/services/log-file-access.service';
import { StatsStoreService } from '../../core/services/stats-store.service';
import { NavigationService } from '../../core/services/navigation.service';
import { SessionRecapService } from '../../core/services/session-recap.service';
import { ConfirmDeleteService } from '../../core/services/confirm-delete.service';
import { I18nService } from '../../core/services/i18n.service';
import { LanguageSwitcherComponent } from '../language-switcher/language-switcher.component';
import { TranslatePipe } from '../translate.pipe';
import { APP_LOGO_PURPLE_DATA_URI } from '../../core/data/app-logo.data';
import { SESSION_RECAP_ICON_DATA_URI } from '../../core/data/session-recap-icon.data';
import { ProfileComponent } from '../../features/profile/profile.component';
import { CatalogService } from '../../core/api/catalog.service';
import { GameServerService } from '../../core/services/game-server.service';

/**
 * En-tête du site (logo, titre, fichier connecté + actions changer/réinitialiser, serveur de jeu,
 * langue, recap de session, accès profil) — rendu une seule fois au niveau racine (voir app.html),
 * commun à toutes les pages. En dessous de 640px, serveur/recap/langue/profil se regroupent dans un
 * menu burger (même principe que `.mobile-menu` ailleurs dans l'app) car ils ne tiennent plus sur
 * une seule ligne à côté du logo/titre/fichier — le serveur y passe en tête, c'est une information
 * d'état, pas une action.
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
  protected readonly catalog = inject(CatalogService);
  protected readonly gameServers = inject(GameServerService);
  protected readonly sessionRecapService = inject(SessionRecapService);
  private readonly stats = inject(StatsStoreService);
  private readonly confirmDelete = inject(ConfirmDeleteService);
  private readonly i18n = inject(I18nService);
  protected readonly appLogo = APP_LOGO_PURPLE_DATA_URI;
  protected readonly sessionRecapIcon = SESSION_RECAP_ICON_DATA_URI;
  protected readonly mobileMenuOpen = signal(false);

  protected onChangeFile(): void {
    void this.logFileAccess.forgetFile();
  }

  /** Réinitialise toute la session en cours (kamas, combats, historique, watchlist...) — action
   * destructive irréversible, confirmée via la même popover partagée que la suppression d'un KPI
   * suivi (voir ConfirmDeleteService). */
  protected onReset(event: Event): void {
    const button = event.currentTarget as HTMLElement;
    this.confirmDelete.open(button, this.i18n.t('app.confirmReset'), () => {
      this.stats.resetStats();
    });
  }

  /** Explique d'où vient le serveur affiché : un personnage reconnu dans le log, ou le repli
   * global du profil (lot 7). Un badge qui ne dirait que « Pandora » laisserait croire à une
   * donnée lue dans le log, alors qu'elle est toujours déclarée par l'utilisateur. */
  protected readonly serverTooltip = computed(() => {
    const active = this.gameServers.activeServer();
    return active
      ? this.i18n.t('app.gameServerFromCharacter', { name: active.characterName })
      : this.i18n.t('app.gameServerUnsetTooltip');
  });

  /** Renvoie vers l'onglet Personnages de la page profil, où le serveur se déclare. */
  protected openServerSetup(): void {
    this.nav.requestProfileCharactersTab();
    this.nav.openProfile();
    this.closeMobileMenu();
  }

  protected toggleMobileMenu(): void {
    this.mobileMenuOpen.update((v) => !v);
  }

  protected closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }
}
