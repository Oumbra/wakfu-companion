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
 * Réévalué à chaque nouvelle connexion réelle du fichier (ou connexion au compte pendant qu'un
 * fichier est lu) : l'avertissement réapparaît donc à chaque fois, « Plus tard » ne le masque que
 * jusqu'à la connexion suivante. Jamais affiché en mode « Continuer sans fichier de log »
 * (`LogFileAccessService.simulated`), qui est précisément la solution proposée.
 */
@Injectable({ providedIn: 'root' })
export class OverlayConflictService {
  private readonly auth = inject(AuthService);
  private readonly logFileAccess = inject(LogFileAccessService);
  private readonly i18n = inject(I18nService);
  private readonly nav = inject(NavigationService);

  private readonly pairedOverlay = signal(false);
  private readonly dismissed = signal(false);
  /** Incrémenté à chaque changement de situation : ignore la réponse d'une vérification périmée. */
  private generation = 0;

  private readonly readingRealFile = computed(
    () =>
      this.auth.isAuthenticated() &&
      this.logFileAccess.status() === 'connected' &&
      !this.logFileAccess.simulated(),
  );

  readonly show = computed(
    () => this.readingRealFile() && this.pairedOverlay() && !this.dismissed(),
  );

  constructor() {
    effect(() => {
      const active = this.readingRealFile();
      untracked(() => {
        const generation = ++this.generation;
        this.pairedOverlay.set(false);
        this.dismissed.set(false);
        if (active) void this.check(generation);
      });
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
    if (generation === this.generation) this.pairedOverlay.set(paired);
  }
}
