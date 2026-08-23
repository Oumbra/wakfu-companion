import { computed, Injectable, inject, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';
import { ProfileTab } from './navigation.service';
import { PROFILE_SECTION_VERSIONS } from '../data/profile-section-versions.data';

const STORAGE_KEY = 'wakfu-profile-section-seen-versions';

type SeenVersions = Partial<Record<ProfileTab, number>>;

const ALL_TABS = Object.keys(PROFILE_SECTION_VERSIONS) as readonly ProfileTab[];

/**
 * Badge "new" desktop uniquement (voir CLAUDE.md — pas assez de valeur en mobile) signalant, par
 * section de la page profil (rail de navigation, `ProfilePageComponent`), qu'elle contient quelque
 * chose que l'utilisateur n'a encore jamais vu — soit sa toute première visite, soit une nouveauté
 * ajoutée après sa dernière visite (voir `PROFILE_SECTION_VERSIONS`, incrémentée manuellement par
 * section quand il y a quelque chose de nouveau à signaler). L'avatar du profil (haut à droite,
 * header desktop) porte lui-même un badge tant qu'AU MOINS une section a quelque chose de nouveau
 * (`hasAnyUnseen`) — voir `ProfileComponent`.
 *
 * Purement une préférence d'affichage locale (même principe que `ThemeService`/`ColorblindService`,
 * `PersistenceService` direct — voir CLAUDE.md) : pas une des données synchronisées via
 * `UserDataService`. Un simple curseur "vu" sans valeur à retrouver d'un appareil à l'autre —
 * revoir une fois de plus un badge déjà vu ailleurs n'est pas gênant, contrairement à un vrai
 * réglage utilisateur.
 */
@Injectable({ providedIn: 'root' })
export class NewSectionBadgeService {
  private readonly persistence = inject(PersistenceService);

  private readonly seenVersions = signal<SeenVersions>(
    this.persistence.getJson<SeenVersions>(STORAGE_KEY) ?? {},
  );

  /** `tab` en `string` (pas `ProfileTab`) : appelé depuis le template du rail avec `tab.id`, typé
   * `string` côté `TabBarItem` (voir `ProfilePageComponent.railButtonLabel`, même pattern) plutôt
   * que de forcer un cast à chaque appel. Une clé inconnue (jamais le cas en pratique, `tabDefs`
   * n'énumère que des `ProfileTab`) répond simplement "rien de nouveau". */
  isUnseen(tab: string): boolean {
    const version = PROFILE_SECTION_VERSIONS[tab as ProfileTab] as number | undefined;
    if (version === undefined) return false;
    return (this.seenVersions()[tab as ProfileTab] ?? 0) < version;
  }

  /** Vrai tant qu'au moins une section a quelque chose de nouveau — pilote le badge global de
   * l'avatar (voir ProfileComponent). */
  readonly hasAnyUnseen = computed(() => ALL_TABS.some((tab) => this.isUnseen(tab)));

  /** Marque `tab` comme vu à sa version courante — appelé à chaque affichage de cette section
   * (voir ProfilePageComponent, à la fois à l'ouverture et à chaque changement d'onglet).
   * Idempotent : n'écrit rien si déjà à jour, pour ne pas re-déclencher inutilement les signaux
   * dérivés (`hasAnyUnseen`) à chaque clic sur une section déjà vue. */
  markSeen(tab: ProfileTab): void {
    const current = PROFILE_SECTION_VERSIONS[tab];
    if ((this.seenVersions()[tab] ?? 0) >= current) return;
    const next = { ...this.seenVersions(), [tab]: current };
    this.seenVersions.set(next);
    this.persistence.setJson(STORAGE_KEY, next);
  }
}
