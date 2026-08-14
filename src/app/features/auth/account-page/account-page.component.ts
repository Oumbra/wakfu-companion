import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { AuthService, AuthSessionInfo } from '../../../core/auth/auth.service';
import { AppDataExportService } from '../../../core/services/app-data-export.service';
import { ConfirmDeleteService } from '../../../core/services/confirm-delete.service';
import { I18nService } from '../../../core/services/i18n.service';
import { NavigationService } from '../../../core/services/navigation.service';
import { AppPageComponent } from '../../../shared/app-page/app-page.component';
import { TranslatePipe } from '../../../shared/translate.pipe';
import { TooltipDirective } from '../../../shared/tooltip/tooltip.directive';

/**
 * Page compte (lot 5, prompt 5.2) : identité, fournisseurs liés, sessions
 * actives avec révocation, export RGPD, suppression du compte, et l'écran de
 * migration des données locales à la première connexion.
 *
 * C'est aussi la page d'atterrissage après un retour OAuth réussi — voir
 * `App.ngOnInit` : c'est là que se prend, le cas échéant, la décision
 * « garder les données locales ou celles du compte ».
 *
 * Elle reste accessible en mode invité, où elle se contente d'inviter à se
 * connecter : aucune garde de route ne l'interdit (contrainte impérative du
 * prompt).
 */
@Component({
  selector: 'app-account-page',
  imports: [AppPageComponent, TranslatePipe, TooltipDirective],
  templateUrl: './account-page.component.html',
  styleUrl: './account-page.component.css',
})
export class AccountPageComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly nav = inject(NavigationService);
  private readonly dataExport = inject(AppDataExportService);
  private readonly confirmDelete = inject(ConfirmDeleteService);
  protected readonly i18n = inject(I18nService);

  protected readonly sessions = signal<readonly AuthSessionInfo[]>([]);
  protected readonly sessionsLoading = signal(false);

  ngOnInit(): void {
    void this.refreshSessions();
  }

  protected goBack(): void {
    this.nav.pop();
  }

  /** Renvoie vers la page profil, onglet Connexion (section Discord/Google, voir CLAUDE.md) —
   * `replace` plutôt que `push` : revenu en arrière depuis là, l'utilisateur ne doit pas retomber
   * sur cette page compte en mode invité qui n'a plus de sens. */
  protected openLogin(): void {
    this.nav.requestProfileConnectionTab();
    this.nav.replace('profile');
  }

  protected async refreshSessions(): Promise<void> {
    if (!this.auth.isAuthenticated()) {
      this.sessions.set([]);
      return;
    }
    this.sessionsLoading.set(true);
    const sessions = await this.auth.listSessions();
    this.sessionsLoading.set(false);
    this.sessions.set(sessions ?? []);
  }

  protected async revokeSession(session: AuthSessionInfo): Promise<void> {
    await this.auth.revokeSession(session.id);
    await this.refreshSessions();
  }

  protected async revokeAll(): Promise<void> {
    await this.auth.revokeSession();
    this.sessions.set([]);
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    this.sessions.set([]);
  }

  /** Suppression irréversible : confirmée par la même popover que les autres actions destructives. */
  protected confirmDeleteAccount(event: Event): void {
    const button = event.currentTarget as HTMLElement;
    this.confirmDelete.open(button, this.i18n.t('auth.account.deleteConfirm'), () => {
      void this.auth.deleteAccount();
    });
  }

  /** Export RGPD — même charge utile que l'export du profil (AppDataExportService). */
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

  protected async chooseMigration(choice: 'upload' | 'download'): Promise<void> {
    await this.auth.resolveMigration(choice);
  }

  /** Clé i18n décrivant l'état courant de la synchronisation (lot 6). */
  protected readonly syncStateKey = computed(() => `auth.sync.${this.auth.syncState()}`);

  /** Relance la synchronisation à la demande — voir `AuthService.syncNow`. */
  protected async syncNow(): Promise<void> {
    this.auth.clearError();
    await this.auth.syncNow();
  }

  protected formatTime(date: Date): string {
    return date.toLocaleTimeString(this.i18n.locale());
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleString(this.i18n.locale());
  }

  /**
   * Étiquette lisible d'une session. Le `User-Agent` brut est illisible : on
   * en extrait navigateur + système, et on retombe sur « appareil inconnu »
   * plutôt que d'afficher une chaîne technique de 200 caractères.
   */
  protected describeSession(session: AuthSessionInfo): string {
    const ua = session.userAgent ?? '';
    if (!ua) return this.i18n.t('auth.account.unknownDevice');

    const browser = /Edg\//.test(ua)
      ? 'Edge'
      : /OPR\//.test(ua)
        ? 'Opera'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null;

    const os = /Windows/.test(ua)
      ? 'Windows'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Mac OS X/.test(ua)
            ? 'macOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;

    if (!browser && !os) return this.i18n.t('auth.account.unknownDevice');
    return [browser, os].filter(Boolean).join(' · ');
  }
}
