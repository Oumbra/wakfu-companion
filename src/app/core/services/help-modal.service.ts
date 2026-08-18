import { Injectable, signal } from '@angular/core';

/** Une entrée par section/feature dotée d'une icône d'aide (voir HelpModalComponent) — la clé
 * sert aussi de préfixe i18n (`help.<section>.title`/`help.<section>.body`). */
export type HelpSection =
  | 'combat'
  | 'tracker'
  | 'fightHistory'
  | 'purchases'
  | 'trades'
  | 'chat'
  | 'profileAlerts'
  | 'profileCharacters'
  | 'profileConnection'
  | 'profileTheme'
  | 'profileColorblind';

/**
 * Pilote la modale d'aide générique (HelpModalComponent, rendue une seule fois au niveau racine —
 * voir app.html) : un simple signal de section ouverte, dans le même esprit que
 * ClassPickerService/ConfirmDeleteService.
 */
@Injectable({ providedIn: 'root' })
export class HelpModalService {
  readonly openSection = signal<HelpSection | null>(null);

  open(section: HelpSection): void {
    this.openSection.set(section);
  }

  close(): void {
    this.openSection.set(null);
  }
}
