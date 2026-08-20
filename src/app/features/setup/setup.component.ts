import { Component, inject, signal } from '@angular/core';
import { LogFileAccessService } from '../../core/services/log-file-access.service';
import { AuthProvider, AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/services/i18n.service';
import {
  BrowserIconComponent,
  BrowserKind,
} from '../../shared/browser-icon/browser-icon.component';
import { TranslatePipe } from '../../shared/translate.pipe';
import { TranslateHtmlPipe } from '../../shared/translate-html.pipe';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { AuthProviderButtonsComponent } from '../../shared/auth-provider-buttons/auth-provider-buttons.component';

interface CompatibleBrowser {
  kind: BrowserKind;
  name: string;
  downloadUrl: string;
}

const COMPATIBLE_BROWSERS: readonly CompatibleBrowser[] = [
  { kind: 'chrome', name: 'Google Chrome', downloadUrl: 'https://www.google.com/chrome/' },
  { kind: 'edge', name: 'Microsoft Edge', downloadUrl: 'https://www.microsoft.com/edge' },
  { kind: 'opera', name: 'Opera', downloadUrl: 'https://www.opera.com/download' },
];

@Component({
  selector: 'app-setup',
  imports: [
    TranslatePipe,
    TranslateHtmlPipe,
    BrowserIconComponent,
    TooltipDirective,
    AuthProviderButtonsComponent,
  ],
  templateUrl: './setup.component.html',
  styleUrl: './setup.component.css',
})
export class SetupComponent {
  protected readonly logFileAccess = inject(LogFileAccessService);
  protected readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);
  protected readonly dragOver = signal(false);
  protected readonly compatibleBrowsers = COMPATIBLE_BROWSERS;
  protected readonly showWhy = signal(false);
  /** Affiche les boutons Discord/Google en dessous du bouton "passer cette étape" (mobile) — voir
   * `skipLogFile()` : uniquement quand l'utilisateur n'est pas encore connecté. */
  protected readonly showSkipLoginPrompt = signal(false);

  protected toggleWhy(): void {
    this.showWhy.update((value) => !value);
  }

  /**
   * Bouton mobile "passer cette étape" (voir CLAUDE.md/tâche associée) : l'API File System Access
   * n'existe sur aucun navigateur mobile, un fichier `wakfu.log` réel n'y est donc jamais
   * atteignable. Déjà connecté (Discord/Google) → simule directement une connexion fichier
   * (`LogFileAccessService.simulateConnected`), ce qui bascule immédiatement sur le tableau de
   * bord (voir app.html, `@if (logFileAccess.status() === 'connected')`) sans quitter la page.
   * Pas encore connecté → révèle les boutons de connexion ; la simulation + redirection a alors
   * lieu au retour du flux OAuth (voir `App.ngOnInit`, qui consomme
   * `AuthService.consumeMobileSkipLoginPending`).
   */
  protected skipLogFile(): void {
    if (this.auth.isAuthenticated()) {
      this.logFileAccess.simulateConnected(this.i18n.t('setup.mobileSkip.simulatedFileName'));
      return;
    }
    this.showSkipLoginPrompt.set(true);
  }

  protected loginForSkip(provider: AuthProvider): void {
    this.auth.clearError();
    this.auth.markMobileSkipLoginPending();
    this.auth.login(provider);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected onDragLeave(): void {
    this.dragOver.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    if (event.dataTransfer) {
      void this.logFileAccess.handleDrop(event.dataTransfer);
    }
  }

  protected pickFile(): void {
    void this.logFileAccess.pickFile();
  }

  protected reconnect(): void {
    void this.logFileAccess.reconnect();
  }

  protected forget(): void {
    void this.logFileAccess.forgetFile();
  }
}
