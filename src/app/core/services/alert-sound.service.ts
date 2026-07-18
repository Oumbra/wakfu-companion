import { Injectable } from '@angular/core';
import { ALERT_SOUND_DATA_URI } from '../data/alert-sound.data';

/** Lecture du son d'alerte commun (loot suivi, filtres de chat...). */
@Injectable({ providedIn: 'root' })
export class AlertSoundService {
  play(): void {
    try {
      const audio = new Audio(ALERT_SOUND_DATA_URI);
      void audio.play();
    } catch {
      // Lecture audio indisponible : l'alerte visuelle reste affichée sans son.
    }
  }
}
