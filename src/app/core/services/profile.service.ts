import { Injectable, inject, signal } from '@angular/core';
import { USER_DATA_KEYS } from '../data-access/user-data.keys';
import { UserDataService } from '../data-access/user-data.service';

/** @deprecated Réexportée pour les consommateurs historiques — la clé fait
 * désormais autorité dans `core/data-access/user-data.keys.ts`. */
export const PROFILE_KEY = USER_DATA_KEYS.profile;

export interface SoundItemEntry {
  name: string;
  enabled: boolean;
  /** Objet de la liste prédéfinie : pas de bouton de suppression (voir removeSoundItem). */
  isDefault: boolean;
}

export type CharacterViewMode = 'list' | 'grid';

interface StoredProfile {
  pseudo: string;
  avatarIndex: number | null;
  soundItems: SoundItemEntry[];
  /** Durée d'affichage du toast d'alerte sonore, en secondes (utilisée seulement si !alertManualClose). */
  alertDurationSeconds: number;
  /** Si vrai, le toast d'alerte sonore ne se ferme plus qu'à la main (voir le bouton de fermeture du toast). */
  alertManualClose: boolean;
  /** Affichage de la liste des personnages (page profil, onglet Personnages). */
  characterViewMode: CharacterViewMode;
}

const DEFAULT_ALERT_DURATION_SECONDS = 3.5;
const MIN_ALERT_DURATION_SECONDS = 0.5;

const DEFAULT_SOUND_ITEM_NAMES: readonly string[] = [
  "Pierre d'aventure",
  "Pierre d'équilibre",
  "Pierre d'entourage",
  'Pierre de vitesse',
  'Pierre ultime',
  'Influence III',
];

/** Profil joueur local : pseudo, avatar (planche de classes Ankama) et liste d'objets à alerte sonore au ramassage. */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly userData = inject(UserDataService);

  readonly pseudo = signal('');
  readonly avatarIndex = signal<number | null>(null);
  readonly soundItems = signal<SoundItemEntry[]>([]);
  readonly alertDurationSeconds = signal(DEFAULT_ALERT_DURATION_SECONDS);
  readonly alertManualClose = signal(false);
  /** Tout interrupteur/switch de l'application doit être persisté ici plutôt que gardé en mémoire (voir setCharacterViewMode). */
  readonly characterViewMode = signal<CharacterViewMode>('list');

  constructor() {
    this.loadFromStorage();
    // Le profil a pu être modifié depuis un autre appareil : recharger les
    // signaux plutôt que de laisser l'écran sur une valeur périmée jusqu'au
    // prochain rechargement de page (lot 6).
    this.userData.onExternalChange('profile', () => this.loadFromStorage());
  }

  private loadFromStorage(): void {
    const stored = this.userData.read<StoredProfile>('profile');
    this.pseudo.set(stored?.pseudo ?? '');
    this.avatarIndex.set(stored?.avatarIndex ?? null);
    this.soundItems.set(
      stored?.soundItems ??
        DEFAULT_SOUND_ITEM_NAMES.map((name) => ({ name, enabled: true, isDefault: true })),
    );
    // Migration : une ancienne version stockait 0 = "fermeture manuelle" dans alertDurationSeconds.
    if (stored?.alertDurationSeconds === 0) {
      this.alertDurationSeconds.set(DEFAULT_ALERT_DURATION_SECONDS);
      this.alertManualClose.set(true);
    } else {
      this.alertDurationSeconds.set(stored?.alertDurationSeconds ?? DEFAULT_ALERT_DURATION_SECONDS);
      this.alertManualClose.set(stored?.alertManualClose ?? false);
    }
    this.characterViewMode.set(stored?.characterViewMode ?? 'list');
  }

  setPseudo(value: string): void {
    this.pseudo.set(value);
    this.persist();
  }

  setAvatar(index: number): void {
    this.avatarIndex.set(index);
    this.persist();
  }

  setAlertDuration(seconds: number): void {
    this.alertDurationSeconds.set(Math.max(MIN_ALERT_DURATION_SECONDS, seconds));
    this.persist();
  }

  setAlertManualClose(value: boolean): void {
    this.alertManualClose.set(value);
    this.persist();
  }

  setCharacterViewMode(value: CharacterViewMode): void {
    this.characterViewMode.set(value);
    this.persist();
  }

  addSoundItem(rawName: string): void {
    const name = rawName.trim();
    if (!name) return;
    const current = this.soundItems();
    if (current.some((e) => e.name.toLowerCase() === name.toLowerCase())) return;
    this.soundItems.set([...current, { name, enabled: true, isDefault: false }]);
    this.persist();
  }

  /** Sans effet sur un objet de la liste prédéfinie (pas de bouton associé côté UI de toute façon). */
  removeSoundItem(name: string): void {
    this.soundItems.set(this.soundItems().filter((e) => e.name !== name || e.isDefault));
    this.persist();
  }

  toggleSoundItem(name: string): void {
    this.soundItems.set(
      this.soundItems().map((e) => (e.name === name ? { ...e, enabled: !e.enabled } : e)),
    );
    this.persist();
  }

  /** Entrée dont le nom (FR, tel que dans les logs) correspond et dont le son est activé, si trouvée. */
  findEnabledSoundItem(itemName: string): SoundItemEntry | undefined {
    const normalized = itemName.toLowerCase().trim();
    return this.soundItems().find((e) => e.enabled && e.name.toLowerCase() === normalized);
  }

  private persist(): void {
    const value: StoredProfile = {
      pseudo: this.pseudo(),
      avatarIndex: this.avatarIndex(),
      soundItems: this.soundItems(),
      alertDurationSeconds: this.alertDurationSeconds(),
      alertManualClose: this.alertManualClose(),
      characterViewMode: this.characterViewMode(),
    };
    this.userData.write('profile', value);
  }
}
