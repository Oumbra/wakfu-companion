import { I18nService } from '../services/i18n.service';
import { LogFileAccessService } from '../services/log-file-access.service';
import { AuthService } from './auth.service';

/**
 * Bouton « Continuer sans fichier de log » (page setup, et son retour OAuth dans `App.ngOnInit`) :
 * simule une connexion fichier (`LogFileAccessService.simulateConnected`) pour un compte connecté.
 * L'étiquette de l'en-tête dit pourquoi aucun fichier n'est lu : « Overlay » si le compte a un
 * overlay appairé (il lit `wakfu.log` et synchronise à la place du site, voir
 * `AuthService.hasPairedOverlay`), « Sans fichier de log » sinon (mobile, ou simple consultation).
 */
export async function connectWithoutFile(
  auth: AuthService,
  logFileAccess: LogFileAccessService,
  i18n: I18nService,
): Promise<void> {
  const paired = await auth.hasPairedOverlay();
  logFileAccess.simulateConnected(
    i18n.t(paired ? 'setup.overlaySkip.simulatedFileName' : 'setup.mobileSkip.simulatedFileName'),
  );
}
