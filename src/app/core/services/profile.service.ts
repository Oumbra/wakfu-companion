import { Injectable, inject, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';

const PROFILE_KEY = 'wakfu-profile';

export interface SoundItemEntry {
  name: string;
  enabled: boolean;
  /** Objet de la liste prédéfinie : pas de bouton de suppression (voir removeSoundItem). */
  isDefault: boolean;
}

interface StoredProfile {
  pseudo: string;
  avatarIndex: number | null;
  soundItems: SoundItemEntry[];
}

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
  private readonly persistence = inject(PersistenceService);

  readonly pseudo = signal('');
  readonly avatarIndex = signal<number | null>(null);
  readonly soundItems = signal<SoundItemEntry[]>([]);

  constructor() {
    const stored = this.persistence.getJson<StoredProfile>(PROFILE_KEY);
    this.pseudo.set(stored?.pseudo ?? '');
    this.avatarIndex.set(stored?.avatarIndex ?? null);
    this.soundItems.set(
      stored?.soundItems ??
        DEFAULT_SOUND_ITEM_NAMES.map((name) => ({ name, enabled: true, isDefault: true })),
    );
  }

  setPseudo(value: string): void {
    this.pseudo.set(value);
    this.persist();
  }

  setAvatar(index: number): void {
    this.avatarIndex.set(index);
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
    };
    this.persistence.setJson(PROFILE_KEY, value);
  }
}
