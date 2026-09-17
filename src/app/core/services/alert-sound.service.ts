import { Injectable, signal } from '@angular/core';
import { ALERT_SOUND_DATA_URI } from '../data/alert-sound.data';
import { CHAT_FILTER_ALERT_SOUND_DATA_URI } from '../data/chat-filter-alert-sound.data';
import { COUNTDOWN_ALERT_SOUND_DATA_URI } from '../data/countdown-alert-sound.data';

/** Lecture des sons d'alerte de l'app — un son distinct par contexte (ramassage d'objet suivi,
 * filtre de chat déclenché, compteur de suivi à 0), chacun testable indépendamment.
 *
 * **Politique autoplay du navigateur** (Chrome notamment) : `HTMLMediaElement.play()` est REJETÉ
 * (`NotAllowedError`) tant que l'utilisateur n'a pas interagi avec la page (clic/touche) dans cet
 * onglet — cas réel et courant ici, puisque `LogFileAccessService.init()` reconnecte le fichier
 * TOUT SEUL au chargement (handle mémorisé + permission déjà accordée), sans qu'aucun clic ne soit
 * jamais nécessaire : le toast s'affiche, mais le son reste muet, silencieusement (ancienne version :
 * `void audio.play()`, rejet avalé). Remonté par un utilisateur le 2026-09-13 (« l'alerte sonore
 * pour une Pierre de vitesse ne s'est pas déclenchée » alors que le chemin applicatif est correct,
 * vérifié en navigateur). Depuis : le rejet est capté, exposé via `blockedByBrowser` (affiché dans
 * le toast, voir LootAlertComponent) et le DERNIER son bloqué est rejoué au tout premier geste
 * utilisateur suivant (`pointerdown`/`keydown`, écouteur à usage unique) — après quoi le navigateur
 * autorise la lecture pour le reste de la session. */
@Injectable({ providedIn: 'root' })
export class AlertSoundService {
  /** Vrai tant qu'un son a été refusé par le navigateur et qu'aucun geste utilisateur n'a encore
   * eu lieu depuis — voir doc de classe. */
  readonly blockedByBrowser = signal(false);

  private pendingUrl: string | null = null;
  private unlockListening = false;

  /** Ramassage d'un objet suivi avec son activé (voir ProfileService) — aussi rejoué par le bouton "Tester" de la page profil. */
  playLoot(): void {
    this.play(ALERT_SOUND_DATA_URI);
  }

  /** Nouveau message de chat correspondant à un filtre suivi. */
  playChatFilter(): void {
    this.play(CHAT_FILTER_ALERT_SOUND_DATA_URI);
  }

  /** Un compteur de suivi est arrivé au bout : décompte à 0, ou objectif atteint (même son). */
  playCountdown(): void {
    this.play(COUNTDOWN_ALERT_SOUND_DATA_URI);
  }

  /** Le fichier n'est réellement téléchargé qu'ici, à la lecture — jamais au démarrage
   * (voir public/assets/sounds/, servis en fichiers statiques hashés). */
  private play(url: string): void {
    let playback: Promise<void>;
    try {
      playback = new Audio(url).play();
    } catch {
      // Lecture audio indisponible : l'alerte visuelle reste affichée sans son.
      return;
    }
    playback.then(
      () => {
        this.pendingUrl = null;
        this.blockedByBrowser.set(false);
      },
      (err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'NotAllowedError')) return;
        this.pendingUrl = url;
        this.blockedByBrowser.set(true);
        this.listenForUnlockGesture();
      },
    );
  }

  private listenForUnlockGesture(): void {
    if (this.unlockListening || typeof document === 'undefined') return;
    this.unlockListening = true;
    const onGesture = (): void => {
      document.removeEventListener('pointerdown', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
      this.unlockListening = false;
      const url = this.pendingUrl;
      this.pendingUrl = null;
      this.blockedByBrowser.set(false);
      // Rejoué DANS le geste utilisateur (capture) : c'est précisément ce qui le rend autorisé.
      if (url) this.play(url);
    };
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
  }
}
