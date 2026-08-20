import { Injectable, NgZone, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';

/** Fréquence de vérification active d'une nouvelle version pendant qu'un onglet reste ouvert
 * longtemps (cas typique de cette app : un onglet gardé ouvert toute une session de jeu). Sans ce
 * polling, Angular ne revérifie qu'à l'enregistrement du service worker (au démarrage de l'app,
 * voir `registerWhenStable:30000` dans app.config.ts) — jamais spontanément ensuite. */
const POLL_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Détecte qu'une nouvelle version de l'app a été déployée (via le service worker Angular, qui
 * télécharge et installe les nouveaux fichiers hashés en arrière-plan sans rien casser de la
 * session en cours) et expose un signal pour proposer le rechargement — voir AppUpdateNoticeComponent.
 * Volontairement PAS de rechargement automatique/forcé : l'app suit des combats en temps réel,
 * un reload en pleine session coupe le suivi (voir StatsStoreService.resetSessionState) — c'est
 * donc à l'utilisateur de choisir le moment.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly zone = inject(NgZone);

  readonly updateReady = signal(false);

  constructor() {
    if (!this.swUpdate.isEnabled) return;

    this.swUpdate.versionUpdates
      .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
      .subscribe(() => this.updateReady.set(true));

    // Un état "unrecoverable" (cache du service worker corrompu) ne se résorbe pas tout seul :
    // aucune session en cours à préserver dans ce cas, reload direct sans passer par la bannière.
    this.swUpdate.unrecoverable.subscribe(() => this.reload());

    // setInterval hors NgZone : un simple polling réseau périodique n'a pas besoin de déclencher
    // de détection de changement Angular à chaque tick (seul le VERSION_READY qui en résulte,
    // éventuellement, en déclenche une via le signal ci-dessus).
    this.zone.runOutsideAngular(() => {
      setInterval(() => void this.swUpdate.checkForUpdate(), POLL_INTERVAL_MS);
    });
  }

  reload(): void {
    document.location.reload();
  }
}
