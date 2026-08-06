import { Injectable } from '@angular/core';
import { ALERT_SOUND_DATA_URI } from '../data/alert-sound.data';
import { CHAT_FILTER_ALERT_SOUND_DATA_URI } from '../data/chat-filter-alert-sound.data';
import { COUNTDOWN_ALERT_SOUND_DATA_URI } from '../data/countdown-alert-sound.data';

/** Lecture des sons d'alerte de l'app — un son distinct par contexte (ramassage d'objet suivi,
 * filtre de chat déclenché, compteur de suivi à 0), chacun testable indépendamment. */
@Injectable({ providedIn: 'root' })
export class AlertSoundService {
  /** Ramassage d'un objet suivi avec son activé (voir ProfileService) — aussi rejoué par le bouton "Tester" de la page profil. */
  playLoot(): void {
    this.play(ALERT_SOUND_DATA_URI);
  }

  /** Nouveau message de chat correspondant à un filtre suivi. */
  playChatFilter(): void {
    this.play(CHAT_FILTER_ALERT_SOUND_DATA_URI);
  }

  /** Un compteur de suivi en mode décompte vient d'atteindre 0. */
  playCountdown(): void {
    this.play(COUNTDOWN_ALERT_SOUND_DATA_URI);
  }

  /** Le fichier n'est réellement téléchargé qu'ici, à la lecture — jamais au démarrage
   * (voir public/assets/sounds/, servis en fichiers statiques hashés). */
  private play(url: string): void {
    try {
      const audio = new Audio(url);
      void audio.play();
    } catch {
      // Lecture audio indisponible : l'alerte visuelle reste affichée sans son.
    }
  }
}
