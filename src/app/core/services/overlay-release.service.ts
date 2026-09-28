import { computed, inject, Injectable, signal } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';
import { AuthService } from '../auth/auth.service';
import { detectClientOs, type ClientOs } from '../utils/client-os.util';
import { LogFileAccessService } from './log-file-access.service';
import { OverlayConflictService } from './overlay-conflict.service';
import { PersistenceService } from './persistence.service';

/** Plateformes pour lesquelles l'overlay de bureau est publié. */
export type OverlayPlatform = 'windows' | 'linux';

/** Réponse de `GET /api/v1/overlay/latest` (`server/overlay/release.ts::OverlayReleaseSummary`). */
export interface OverlayReleaseSummary {
  version: string;
  publishedAt: string | null;
  notesUrl: string | null;
  platforms: Partial<Record<OverlayPlatform, { size: number; installedSize: number }>>;
}

/** Clé `localStorage` (donnée locale non synchronisée) : bannière d'annonce de l'overlay fermée. */
const ANNOUNCEMENT_DISMISSED_KEY = 'overlayAnnouncementDismissed';

/** Script d'installation Linux, fichier statique du site (`public/overlay/install-linux.sh`). */
const LINUX_INSTALL_SCRIPT_PATH = '/overlay/install-linux.sh';

/**
 * Téléchargement de l'overlay de bureau depuis le site : système du visiteur, dernière version
 * publiée (lue côté serveur dans le manifeste des Releases GitHub, voir
 * `functions/api/v1/overlay/latest.ts`) et bannière d'annonce affichée aux utilisateurs connectés
 * (`OverlayAnnouncementComponent`) jusqu'à ce qu'ils la ferment ou téléchargent l'overlay.
 *
 * Le binaire lui-même n'est jamais chargé par un `fetch` : le bouton est un lien vers
 * `/api/v1/overlay/download/{plateforme}`, que le navigateur télécharge directement.
 */
@Injectable({ providedIn: 'root' })
export class OverlayReleaseService {
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly persistence = inject(PersistenceService);
  private readonly logFileAccess = inject(LogFileAccessService);
  private readonly overlayConflict = inject(OverlayConflictService);

  /** Système détecté au chargement de la page. */
  readonly clientOs: ClientOs = detectClientOs(
    navigator as Navigator & {
      userAgentData?: { platform?: string; mobile?: boolean };
    },
  );

  readonly release = signal<OverlayReleaseSummary | null>(null);
  readonly releaseState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');

  private readonly announcementDismissed = signal(this.readDismissed());

  /**
   * Bannière d'annonce : connecté, sur un système où l'overlay tourne, pas encore fermée — et
   * `wakfu.log` connecté : la bannière mène à l'onglet Connexion du profil, page que
   * `fileConnectedGuard` réserve à ce cas (le bouton profil de l'en-tête est lui aussi masqué avant).
   * Jamais pour un compte qui a déjà un overlay appairé : attend la réponse de la vérification
   * (`OverlayConflictService.pairedOverlay` à `false`) pour ne pas apparaître un instant à tort.
   */
  readonly showAnnouncement = computed(
    () =>
      this.auth.isAuthenticated() &&
      this.logFileAccess.status() === 'connected' &&
      !this.announcementDismissed() &&
      this.overlayConflict.pairedOverlay() === false &&
      (this.clientOs === 'windows' || this.clientOs === 'linux'),
  );

  readonly linuxInstallScriptPath = LINUX_INSTALL_SCRIPT_PATH;

  /** Commande à coller dans un terminal Linux (origine courante : preview comme production). */
  readonly linuxInstallCommand = `curl -fsSL ${location.origin}${LINUX_INSTALL_SCRIPT_PATH} | sh`;

  downloadUrl(platform: OverlayPlatform): string {
    return `/api/v1/overlay/download/${platform}`;
  }

  /** Charge la dernière version publiée (une seule fois ; réessaie après un échec). */
  async loadRelease(): Promise<void> {
    const state = this.releaseState();
    if (state === 'loading' || state === 'ready') return;
    this.releaseState.set('loading');
    const result = await this.api.getJson<OverlayReleaseSummary>('/overlay/latest', {
      retries: 1,
    });
    if (result.ok) {
      this.release.set(result.data);
      this.releaseState.set('ready');
    } else {
      this.releaseState.set('error');
    }
  }

  dismissAnnouncement(): void {
    this.announcementDismissed.set(true);
    try {
      this.persistence.setJson(ANNOUNCEMENT_DISMISSED_KEY, true);
    } catch {
      // Stockage indisponible : la bannière reviendra au prochain chargement, sans gravité.
    }
  }

  private readDismissed(): boolean {
    try {
      return this.persistence.getJson<boolean>(ANNOUNCEMENT_DISMISSED_KEY) === true;
    } catch {
      return false;
    }
  }
}
