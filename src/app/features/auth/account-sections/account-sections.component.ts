import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService, AuthSessionInfo } from '../../../core/auth/auth.service';
import { AccountExportService } from '../../../core/services/account-export.service';
import {
  AppDataExportService,
  type AppDataExport,
} from '../../../core/services/app-data-export.service';
import { ConfirmDeleteService } from '../../../core/services/confirm-delete.service';
import { PersistenceService } from '../../../core/services/persistence.service';
import { I18nService } from '../../../core/services/i18n.service';
import { TranslatePipe } from '../../../shared/translate.pipe';
import { SwitchComponent } from '../../../shared/switch/switch.component';
import { TooltipDirective } from '../../../shared/tooltip/tooltip.directive';

/**
 * Blocs du compte affichés sous les boutons Discord/Google de l'onglet Connexion du profil
 * (lot 5, prompt 5.2) : décision de migration des données locales, identité, appareils connectés
 * avec révocation, mes données (synchronisation, export), déconnexion et suppression du compte.
 *
 * Remplace l'ancienne page « Mon compte » (vue `account`, supprimée) : tout ce qui concerne la
 * connexion tient désormais sur un seul écran, sans navigation supplémentaire. L'ancienne URL
 * `/account` redirige vers `/profile/connection` (voir app.routes.ts), et le retour OAuth atterrit
 * sur cet onglet (voir `App.ngOnInit`) — c'est donc là que se prend, le cas échéant, la décision
 * « garder les données locales ou celles du compte ».
 *
 * En invité, seul le bloc « Cet appareil » reste : effacer toutes les données locales est promis
 * par la politique de confidentialité (§5 et §6), connecté ou non.
 */
@Component({
  selector: 'app-account-sections',
  imports: [TranslatePipe, TooltipDirective, SwitchComponent],
  templateUrl: './account-sections.component.html',
  styleUrl: './account-sections.component.css',
})
export class AccountSectionsComponent {
  protected readonly auth = inject(AuthService);
  private readonly dataExport = inject(AppDataExportService);
  private readonly accountExport = inject(AccountExportService);
  private readonly confirmDelete = inject(ConfirmDeleteService);
  private readonly persistence = inject(PersistenceService);
  protected readonly i18n = inject(I18nService);

  protected readonly sessions = signal<readonly AuthSessionInfo[]>([]);
  protected readonly sessionsLoading = signal(false);
  /** Export en cours de composition (plusieurs requêtes en mode connecté, voir `exportData`). */
  protected readonly exporting = signal(false);
  protected readonly exportFailed = signal(false);

  /** Libellé du nombre d'appareils dans l'en-tête du bloc (singulier/pluriel : deux clés). */
  protected readonly sessionsCountLabel = computed(() => {
    const count = this.sessions().length;
    return this.i18n.t(
      count === 1 ? 'auth.account.sessionsCountOne' : 'auth.account.sessionsCountMany',
      { count },
    );
  });

  constructor() {
    // Le composant vit dans l'onglet Connexion, monté dès l'ouverture du profil — souvent AVANT que
    // `/auth/me` ait répondu (lien direct, F5, retour OAuth) : la liste des appareils suit donc
    // l'état de connexion plutôt que d'être chargée une seule fois à l'initialisation.
    effect(() => {
      if (this.auth.isAuthenticated()) untracked(() => void this.refreshSessions());
      else this.sessions.set([]);
    });
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

  /**
   * Toutes les actions destructives de cette page passent par la même popover de confirmation
   * (`ConfirmDeleteService`) : révoquer un appareil, tous les appareils, se déconnecter, supprimer
   * le compte ou effacer les données locales. Aucune ne part sur un simple clic.
   */
  protected confirmRevokeSession(session: AuthSessionInfo, event: Event): void {
    this.confirm(event, 'auth.account.revokeConfirm', () => void this.revokeSession(session));
  }

  /** Révoque aussi la session courante : l'utilisateur se retrouve déconnecté (voir le message). */
  protected confirmRevokeAll(event: Event): void {
    this.confirm(event, 'auth.account.revokeAllConfirm', () => void this.revokeAll());
  }

  protected confirmLogout(event: Event): void {
    const key = this.wipeLocalOnLogout()
      ? 'auth.account.logoutWipeConfirm'
      : 'auth.account.logoutConfirm';
    this.confirm(event, key, () => void this.logout());
  }

  private confirm(event: Event, messageKey: string, onConfirm: () => void): void {
    const button = event.currentTarget as HTMLElement;
    this.confirmDelete.open(button, this.i18n.t(messageKey), onConfirm);
  }

  protected async revokeSession(session: AuthSessionInfo): Promise<void> {
    await this.auth.revokeSession(session.id);
    await this.refreshSessions();
  }

  protected async revokeAll(): Promise<void> {
    await this.auth.revokeSession();
    this.sessions.set([]);
  }

  /**
   * « Effacer aussi les données de cet appareil » à la déconnexion (navigateur partagé) — décoché
   * par défaut : sur un PC personnel, retrouver sa configuration en mode invité après une
   * déconnexion est le comportement attendu. Voir `AuthService.logout`.
   */
  protected readonly wipeLocalOnLogout = signal(false);

  protected async logout(): Promise<void> {
    const wipe = this.wipeLocalOnLogout();
    const outcome = await this.auth.logout({ wipeLocalData: wipe });
    if (outcome === 'unsynced') return;
    this.sessions.set([]);
    // Les services gardent les anciennes valeurs en mémoire : on repart de zéro.
    if (wipe) window.location.reload();
  }

  /**
   * « Effacer aussi les données de cet appareil » à la suppression du compte (RGPD art. 17,
   * écart 4.9 de `docs/analyse-rgpd.md`) — décoché par défaut : le mode invité reste pleinement
   * utilisable après la suppression, et effacer d'office les données locales de quelqu'un qui n'a
   * demandé que la suppression de son compte serait une destruction surprise. Coché, c'est le
   * pendant du bouton « Supprimer les données locales » de l'overlay.
   */
  protected readonly wipeLocalOnDelete = signal(false);

  /** Suppression irréversible : confirmée par la même popover que les autres actions destructives. */
  protected confirmDeleteAccount(event: Event): void {
    this.confirm(event, 'auth.account.deleteConfirm', () => void this.deleteAccount());
  }

  /**
   * Mode invité : « Supprimer les données de cet appareil » — la seule façon, dans l'application,
   * d'effacer réellement TOUT le stockage local (le « Réinitialiser » de l'en-tête ne remet à zéro
   * que la session de statistiques : kamas, combats, compteurs — jamais le profil, le roster ni
   * les filtres de chat). Promis par la politique de confidentialité (§5 et §6), pendant du bouton
   * de l'overlay.
   */
  protected confirmWipeLocal(event: Event): void {
    this.confirm(event, 'auth.account.wipeLocalConfirm', () => {
      void this.persistence.wipeLocalData().then(() => window.location.reload());
    });
  }

  private async deleteAccount(): Promise<void> {
    const deleted = await this.auth.deleteAccount();
    if (!deleted || !this.wipeLocalOnDelete()) return;
    // Après le retour en mode invité (`becomeGuest`, déjà fait par `deleteAccount`), plus rien ne
    // synchronise : on peut vider le disque, puis repartir de zéro — même mécanique que l'import
    // d'un fichier de configurations (`ProfilePageComponent.onImportFileSelected`).
    await this.persistence.wipeLocalData();
    window.location.reload();
  }

  /**
   * Export RGPD (droit d'accès et portabilité, politique de confidentialité §6) :
   * la configuration de cet appareil (`AppDataExportService`, les 11 clés de
   * `USER_DATA_KEYS`, même format que l'export du profil) et, en mode connecté,
   * TOUT ce que le serveur détient sur le compte (`AccountExportService` :
   * identité, identités OAuth, sessions, configuration synchronisée, historique
   * complet) sous la clé `account`. Le bouton n'est rendu qu'en mode connecté
   * (voir le template) ; la garde `isAuthenticated()` ci-dessous est défensive —
   * en invité il n'existerait de toute façon rien d'autre que le local, et
   * l'export de configuration reste disponible depuis la page profil.
   *
   * Le fichier reste importable (`applyImport` ne lit que `data`). La promesse
   * « en un clic » de la politique (4 locales) repose sur cette méthode : si le
   * périmètre change, relire le texte.
   *
   * Tout ou rien : un échec réseau à mi-parcours ne produit AUCUN fichier
   * (l'utilisateur croirait un fichier partiel complet), seulement l'erreur.
   */
  protected async exportData(): Promise<void> {
    if (this.exporting()) return;
    this.exportFailed.set(false);
    const payload: AppDataExport = this.dataExport.buildExport();
    if (this.auth.isAuthenticated()) {
      this.exporting.set(true);
      try {
        payload.account = await this.accountExport.build();
      } catch {
        this.exportFailed.set(true);
        return;
      } finally {
        this.exporting.set(false);
      }
    }
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
