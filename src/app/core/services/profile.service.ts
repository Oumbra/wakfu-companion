import { Injectable, inject, signal } from '@angular/core';
import { USER_DATA_KEYS } from '../data-access/user-data.keys';
import { UserDataService } from '../data-access/user-data.service';
import { CatalogService } from '../api/catalog.service';
import {
  AVATAR_INDEX_SCHEMA_VERSION,
  migrateLegacyAvatarIndex,
} from '../data/class-portraits.data';

/** @deprecated Réexportée pour les consommateurs historiques — la clé fait
 * désormais autorité dans `core/data-access/user-data.keys.ts`. */
export const PROFILE_KEY = USER_DATA_KEYS.profile;

export interface SoundItemEntry {
  name: string;
  enabled: boolean;
  /** Objet de la liste prédéfinie : pas de bouton de suppression (voir removeSoundItem). */
  isDefault: boolean;
  /** Id Ankama de l'objet, capturé à l'ajout (voir WakfuSearchResult.id) ou résolu par nom au
   * chargement pour les entrées antérieures à ce champ (voir normalizeSoundItem) — même principe
   * que WatchlistEntry.catalogId (stats-store.service.ts) : résolution non ambiguë de l'icône en
   * cas d'homonymes. `null` si jamais résolu. */
  catalogId: number | null;
}

export type CharacterViewMode = 'list' | 'grid';

interface StoredProfile {
  pseudo: string;
  avatarIndex: number | null;
  /** Absent (profils créés avant ce champ) = ancien schéma `avatarIndex` (0-35, planche
   * `class-breeds.data.ts` : 18 classes x 2 sexes) — migré à la volée vers le nouveau schéma
   * (`AVATAR_INDEX_SCHEMA_VERSION`, planche `class-portraits.data.ts`, 1 seul portrait par classe)
   * à la prochaine lecture, voir loadFromStorage. */
  avatarSchemaVersion?: number;
  /** Avatar "Fan-Art" choisi (voir avatar-fanart-galleries.data.ts), prioritaire sur `avatarIndex`
   * pour l'affichage quand non nul (voir setAvatarExternal). `avatarIndex` reste inchangé dans ce
   * cas — repris tel quel si l'utilisateur revient à la "Galerie MMO". */
  avatarExternalUrl?: string | null;
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
  'Plan "Epée de Bonta"',
  'Plan "Epée de Brâkmar"',
  'Plan "Epée de Sufokia"',
  'Plan "Epée d\'Amakna"',
];

/** Profil joueur local : pseudo, avatar (planche de classes Ankama) et liste d'objets à alerte sonore au ramassage. */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly userData = inject(UserDataService);
  private readonly catalog = inject(CatalogService);

  readonly pseudo = signal('');
  readonly avatarIndex = signal<number | null>(null);
  /** Avatar "Fan-Art" choisi (url complète), prioritaire sur `avatarIndex` quand non nul. */
  readonly avatarExternalUrl = signal<string | null>(null);
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
    // Migration one-shot : un `avatarIndex` stocké sous un ancien schéma (voir avatarSchemaVersion
    // ci-dessus, et migrateLegacyAvatarIndex pour le détail v1/v2) est reconverti vers le schéma
    // courant. Un `avatarIndex` déjà à jour (avatarSchemaVersion === AVATAR_INDEX_SCHEMA_VERSION)
    // n'est jamais retouché.
    const rawAvatarIndex = stored?.avatarIndex ?? null;
    const needsAvatarMigration =
      rawAvatarIndex !== null && stored?.avatarSchemaVersion !== AVATAR_INDEX_SCHEMA_VERSION;
    this.avatarIndex.set(
      needsAvatarMigration
        ? migrateLegacyAvatarIndex(rawAvatarIndex, stored?.avatarSchemaVersion)
        : rawAvatarIndex,
    );
    this.avatarExternalUrl.set(stored?.avatarExternalUrl ?? null);
    const mergedSoundItems = this.mergeWithDefaultSoundItems(stored?.soundItems);
    this.soundItems.set(mergedSoundItems);
    // Migration : une ancienne version stockait 0 = "fermeture manuelle" dans alertDurationSeconds.
    if (stored?.alertDurationSeconds === 0) {
      this.alertDurationSeconds.set(DEFAULT_ALERT_DURATION_SECONDS);
      this.alertManualClose.set(true);
    } else {
      this.alertDurationSeconds.set(stored?.alertDurationSeconds ?? DEFAULT_ALERT_DURATION_SECONDS);
      this.alertManualClose.set(stored?.alertManualClose ?? false);
    }
    this.characterViewMode.set(stored?.characterViewMode ?? 'list');
    // Un profil existant dont la fusion a ajouté de nouveaux objets par défaut, ou dont
    // l'avatar vient d'être migré, doit être re-sauvegardé — sinon le changement (mémoire
    // uniquement) est perdu au prochain rechargement tant que l'utilisateur ne déclenche pas
    // lui-même une autre écriture (persist()).
    if (needsAvatarMigration || (stored?.soundItems && mergedSoundItems !== stored.soundItems)) {
      this.persist();
    }
  }

  /** Résout `catalogId` par nom pour un objet, best-effort — utilisé pour les défauts (jamais
   * persistés avec un id) et pour les entrées stockées avant l'introduction de ce champ. Ne lève
   * pas l'ambiguïté d'un homonyme (voir WatchlistEntry.catalogId), mais reste déterministe. */
  private normalizeSoundItem(
    entry: Partial<Pick<SoundItemEntry, 'catalogId'>> & Omit<SoundItemEntry, 'catalogId'>,
  ): SoundItemEntry {
    return {
      ...entry,
      catalogId: entry.catalogId ?? this.catalog.findWakfuItemEntry(entry.name)?.id ?? null,
    };
  }

  /**
   * Fusionne les objets par défaut avec ceux déjà stockés : un profil existant garde son
   * ordre/état `enabled` d'origine, mais tout nouvel objet ajouté à `DEFAULT_SOUND_ITEM_NAMES`
   * depuis la dernière sauvegarde du profil est ajouté à la suite (sinon un profil déjà
   * initialisé ne verrait jamais les nouveaux défauts — `stored.soundItems` prime toujours
   * sur la constante une fois qu'il existe).
   */
  private mergeWithDefaultSoundItems(stored: SoundItemEntry[] | undefined): SoundItemEntry[] {
    const defaults = DEFAULT_SOUND_ITEM_NAMES.map((name) =>
      this.normalizeSoundItem({ name, enabled: true, isDefault: true }),
    );
    if (!stored) return defaults;
    // Ne remappe (nouvelle référence) que si au moins une entrée stockée n'a jamais eu son
    // catalogId résolu (champ absent du JSON, entrées antérieures à ce champ) — sinon `stored`
    // est renvoyé tel quel, pour ne pas déclencher une réécriture à chaque chargement (voir
    // loadFromStorage, qui compare par référence pour décider de persister la fusion).
    const needsBackfill = stored.some((e) => e.catalogId === undefined);
    const normalizedStored = needsBackfill ? stored.map((e) => this.normalizeSoundItem(e)) : stored;
    const existingNames = new Set(normalizedStored.map((e) => e.name.toLowerCase()));
    const missingDefaults = defaults.filter((d) => !existingNames.has(d.name.toLowerCase()));
    return missingDefaults.length > 0
      ? [...normalizedStored, ...missingDefaults]
      : normalizedStored;
  }

  setPseudo(value: string): void {
    this.pseudo.set(value);
    this.persist();
  }

  setAvatar(index: number): void {
    this.avatarIndex.set(index);
    this.avatarExternalUrl.set(null);
    this.persist();
  }

  /** Choix d'un avatar "Fan-Art" (voir avatar-fanart-galleries.data.ts) — ne touche pas
   * `avatarIndex`, repris tel quel si l'utilisateur revient à la "Galerie MMO". */
  setAvatarExternal(url: string): void {
    this.avatarExternalUrl.set(url);
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

  /** Refuse un doublon exact (même id), mais pas deux entrées homonymes d'id différent (ex. les
   * deux "Larme d'Ogrest") — même règle que StatsStoreService.addWatched. Repli sur le nom seul
   * quand l'un des deux (le candidat ou une entrée déjà présente) n'a pas d'id résolu. */
  addSoundItem(rawName: string, catalogId: number | null = null): void {
    const name = rawName.trim();
    if (!name) return;
    const current = this.soundItems();
    const normalized = name.toLowerCase();
    const isDuplicate = current.some((e) => {
      if (catalogId !== null && e.catalogId !== null) return e.catalogId === catalogId;
      return e.name.toLowerCase() === normalized;
    });
    if (isDuplicate) return;
    this.soundItems.set([...current, { name, enabled: true, isDefault: false, catalogId }]);
    this.persist();
  }

  /**
   * `catalogId` **non fourni** (`undefined`) : repli sur le nom seul (comportement historique).
   * Fourni (y compris `null`) : cible exactement la paire — nécessaire pour agir sur une seule
   * des deux entrées quand deux objets suivis partagent le même nom (voir addSoundItem).
   * Sans effet sur un objet de la liste prédéfinie (pas de bouton associé côté UI de toute façon).
   */
  removeSoundItem(name: string, catalogId?: number | null): void {
    this.soundItems.set(
      this.soundItems().filter(
        (e) =>
          e.isDefault ||
          !(e.name === name && (catalogId === undefined || e.catalogId === catalogId)),
      ),
    );
    this.persist();
  }

  toggleSoundItem(name: string, catalogId?: number | null): void {
    this.soundItems.set(
      this.soundItems().map((e) =>
        e.name === name && (catalogId === undefined || e.catalogId === catalogId)
          ? { ...e, enabled: !e.enabled }
          : e,
      ),
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
      avatarSchemaVersion: AVATAR_INDEX_SCHEMA_VERSION,
      avatarExternalUrl: this.avatarExternalUrl(),
      soundItems: this.soundItems(),
      alertDurationSeconds: this.alertDurationSeconds(),
      alertManualClose: this.alertManualClose(),
      characterViewMode: this.characterViewMode(),
    };
    this.userData.write('profile', value);
  }
}
