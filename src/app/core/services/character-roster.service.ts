import { Injectable, inject, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';
import { Gender } from '../data/class-icons.data';
import { normalizeWakfuName } from '../utils/wakfu-name.util';

const ROSTER_KEY = 'wakfu-character-roster';

export interface RosterCharacter {
  name: string;
  className: string;
  gender: Gender;
}

export interface RosterAccount {
  id: string;
  label: string;
  characters: RosterCharacter[];
  /** Compte principal créé automatiquement : toujours présent, pas de bouton de suppression (voir removeAccount). */
  isDefault?: boolean;
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Comptes et personnages déclarés manuellement (page profil) : source de
 * vérité prioritaire pour la classification d'un personnage repéré par son
 * nom exact dans les logs (classe, sexe, camp allié) — avant repli sur la
 * détection automatique via les sorts lancés (voir EntityClassifierService,
 * qui consomme ce service).
 */
@Injectable({ providedIn: 'root' })
export class CharacterRosterService {
  private readonly persistence = inject(PersistenceService);

  readonly accounts = signal<RosterAccount[]>(this.loadAccounts());

  /** Garantit qu'un compte principal existe toujours et ne peut être
   * supprimé : créé au premier lancement, ou rétabli sur d'anciennes
   * données stockées avant l'introduction de ce champ (le 1er compte
   * devient alors le compte principal). */
  private loadAccounts(): RosterAccount[] {
    const stored = this.persistence.getJson<RosterAccount[]>(ROSTER_KEY) ?? [];
    if (stored.length === 0) {
      return [{ id: generateId(), label: '', characters: [], isDefault: true }];
    }
    if (!stored.some((a) => a.isDefault)) {
      return stored.map((a, i) => (i === 0 ? { ...a, isDefault: true } : a));
    }
    return stored;
  }

  /** Recherche insensible à la casse à travers tous les comptes déclarés. */
  findCharacter(name: string): RosterCharacter | undefined {
    const key = normalizeWakfuName(name);
    for (const account of this.accounts()) {
      const found = account.characters.find((c) => normalizeWakfuName(c.name) === key);
      if (found) return found;
    }
    return undefined;
  }

  hasCharacter(name: string): boolean {
    return this.findCharacter(name) !== undefined;
  }

  addAccount(): void {
    this.accounts.update((list) => [...list, { id: generateId(), label: '', characters: [] }]);
    this.persist();
  }

  /** Sans effet sur le compte principal (voir `isDefault`) — pas de bouton associé côté UI de toute façon. */
  removeAccount(id: string): void {
    this.accounts.update((list) => list.filter((a) => a.id !== id || a.isDefault));
    this.persist();
  }

  renameAccount(id: string, label: string): void {
    this.accounts.update((list) =>
      list.map((a) => (a.id === id ? { ...a, label: label.trim() } : a)),
    );
    this.persist();
  }

  /** Écrase silencieusement un personnage homonyme déjà déclaré dans ce compte. */
  addCharacter(accountId: string, rawName: string, className: string, gender: Gender): void {
    const name = rawName.trim();
    if (!name) return;
    this.accounts.update((list) =>
      list.map((a) => {
        if (a.id !== accountId) return a;
        const withoutDup = a.characters.filter(
          (c) => normalizeWakfuName(c.name) !== normalizeWakfuName(name),
        );
        return { ...a, characters: [...withoutDup, { name, className, gender }] };
      }),
    );
    this.persist();
  }

  removeCharacter(accountId: string, name: string): void {
    this.accounts.update((list) =>
      list.map((a) =>
        a.id === accountId ? { ...a, characters: a.characters.filter((c) => c.name !== name) } : a,
      ),
    );
    this.persist();
  }

  private persist(): void {
    this.persistence.setJson(ROSTER_KEY, this.accounts());
  }
}
