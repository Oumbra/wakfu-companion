import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { connectWithoutFile } from '../auth/connect-without-file';
import { I18nService } from './i18n.service';
import { LogFileAccessService } from './log-file-access.service';
import { NavigationService } from './navigation.service';

/**
 * Avertissement « fichier lu en double » (`OverlayConflictNoticeComponent`) : un compte connecté
 * qui a un overlay appairé (`AuthService.hasPairedOverlay`) ET un vrai `wakfu.log` ouvert dans le
 * site fait lire le même fichier deux fois — l'overlay et le site envoient chacun les combats au
 * serveur, d'où des doublons dans les données synchronisées et affichées.
 *
 * Présence d'un overlay appairé (`pairedOverlay`) vérifiée à chaque connexion au tableau de bord
 * d'un compte connecté, avec ou sans fichier : elle masque aussi la bannière « Nouveau »
 * (`OverlayReleaseService.showAnnouncement`). L'avertissement réapparaît à chaque nouvelle
 * connexion réelle du fichier, « Plus tard » ne le masque que jusqu'à la connexion suivante.
 * Jamais affiché en mode « Continuer sans fichier de log » (`LogFileAccessService.simulated`),
 * qui est précisément la solution proposée.
 */
@Injectable({ providedIn: 'root' })
export class OverlayConflictService {
  private readonly auth = inject(AuthService);
  private readonly logFileAccess = inject(LogFileAccessService);
  private readonly i18n = inject(I18nService);
  private readonly nav = inject(NavigationService);

  /**
   * Overlay appairé au compte : `null` tant que la vérification n'a pas répondu (ou hors du
   * tableau de bord, ou en invité), puis `true`/`false`.
   */
  private readonly _pairedOverlay = signal<boolean | null>(null);
  readonly pairedOverlay = this._pairedOverlay.asReadonly();
  private readonly dismissed = signal(false);
  /** Incrémenté à chaque changement de situation : ignore la réponse d'une vérification périmée. */
  private generation = 0;

  private readonly onDashboard = computed(
    () => this.auth.isAuthenticated() && this.logFileAccess.status() === 'connected',
  );

  private readonly readingRealFile = computed(
    () => this.onDashboard() && !this.logFileAccess.simulated(),
  );

  readonly show = computed(
    () => this.readingRealFile() && this.pairedOverlay() === true && !this.dismissed(),
  );

  constructor() {
    effect(() => {
      const active = this.onDashboard();
      untracked(() => {
        const generation = ++this.generation;
        this._pairedOverlay.set(null);
        if (active) void this.check(generation);
      });
    });
    effect(() => {
      this.readingRealFile();
      untracked(() => this.dismissed.set(false));
    });
  }

  dismiss(): void {
    this.dismissed.set(true);
  }

  /**
   * Bascule en mode overlay : oublie le `wakfu.log` lu par le site puis reprend la connexion sans
   * fichier — même résultat que « Changer de fichier » (⇄) suivi de « Continuer sans fichier de
   * log », l'en-tête affichant alors « Overlay ».
   */
  async switchToOverlay(): Promise<void> {
    this.dismissed.set(true);
    await this.logFileAccess.forgetFile();
    this.nav.goTo('main');
    await connectWithoutFile(this.auth, this.logFileAccess, this.i18n);
  }

  private async check(generation: number): Promise<void> {
    const paired = await this.auth.hasPairedOverlay();
    if (generation === this.generation) this._pairedOverlay.set(paired);
  }
}
