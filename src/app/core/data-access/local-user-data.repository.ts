import { Injectable, inject } from '@angular/core';
import { PersistenceService } from '../services/persistence.service';
import { USER_DATA_KEYS, USER_DATA_META_KEY, type UserDataKey } from './user-data.keys';
import type { UserDataRepository } from './user-data.repository';

/** Horodatage de dernière modification, par champ (voir `USER_DATA_META_KEY`). */
type UserDataMeta = Partial<Record<UserDataKey, string>>;

/**
 * Mode invité : exactement le comportement d'avant le lot 6 —
 * `localStorage` via `PersistenceService`, aucune requête réseau, jamais.
 *
 * Seul ajout : un horodatage par champ, tenu à jour à chaque écriture. Il ne
 * sert à rien tant que l'utilisateur reste invité, mais il doit être là **dès
 * ce moment-là** : c'est lui qui permettra, à la première connexion puis à
 * chaque synchronisation, de savoir laquelle des deux versions est la plus
 * récente (prompt 6.1 point 4). Le calculer après coup serait impossible.
 *
 * Cette classe est aussi le socle du mode connecté :
 * `RemoteUserDataRepository` la compose au lieu de réimplémenter le stockage —
 * la copie locale reste la source de vérité immédiate dans les deux modes
 * (voir le commentaire de `UserDataRepository`).
 */
@Injectable({ providedIn: 'root' })
export class LocalUserDataRepository implements UserDataRepository {
  readonly kind = 'local' as const;

  private readonly persistence = inject(PersistenceService);

  read<T>(key: UserDataKey): T | undefined {
    return this.persistence.getJson<T>(USER_DATA_KEYS[key]);
  }

  /**
   * Horodate au plus tard entre « maintenant » et « la version remplacée + 1 ms ».
   *
   * Le second cas n'est pas théorique : si la valeur courante vient d'un autre
   * appareil dont l'horloge avance (le serveur tolère jusqu'à 24 h d'écart,
   * voir `MAX_CLOCK_SKEW_MS`), une modification horodatée à l'heure locale
   * serait *antérieure* à ce qu'elle remplace — donc refusée par l'arbitrage,
   * et l'utilisateur ne pourrait plus rien changer sur cet appareil jusqu'à ce
   * que son horloge rattrape l'autre. Constaté en vérification navigateur.
   * Repartir de la version remplacée garantit qu'une modification locale gagne
   * toujours contre ce qu'elle vient d'écraser, sans casser la comparaison
   * entre appareils.
   */
  write(key: UserDataKey, value: unknown): void {
    const previous = this.updatedAt(key);
    const now = new Date();
    const at =
      previous && previous.getTime() >= now.getTime() ? new Date(previous.getTime() + 1) : now;
    this.writeAt(key, value, at);
  }

  /**
   * Écriture avec horodatage imposé — utilisée quand la valeur vient du compte
   * (hydratation) : elle doit conserver la date du serveur, sans quoi elle
   * paraîtrait plus récente que l'original et repartirait indéfiniment en
   * synchronisation.
   */
  writeAt(key: UserDataKey, value: unknown, updatedAt: Date): void {
    this.persistence.setJson(USER_DATA_KEYS[key], value);
    this.touch(key, updatedAt);
  }

  async flush(): Promise<void> {
    // Mode invité : rien n'est jamais en attente d'envoi.
  }

  /** Date de dernière modification locale de ce champ, si connue. */
  updatedAt(key: UserDataKey): Date | null {
    const iso = this.meta()[key];
    if (!iso) return null;
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  touch(key: UserDataKey, updatedAt: Date): void {
    this.persistence.setJson(USER_DATA_META_KEY, {
      ...this.meta(),
      [key]: updatedAt.toISOString(),
    });
  }

  /**
   * Représentation stable d'une valeur, pour décider si une version distante
   * change réellement quelque chose. Comparer le JSON évite de notifier (et
   * donc de faire recharger leurs signaux à) des services pour une valeur
   * strictement identique.
   */
  serialized(key: UserDataKey): string | undefined {
    const value = this.read(key);
    return value === undefined ? undefined : JSON.stringify(value);
  }

  private meta(): UserDataMeta {
    return this.persistence.getJson<UserDataMeta>(USER_DATA_META_KEY) ?? {};
  }
}
