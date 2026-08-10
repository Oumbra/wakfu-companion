import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClientService } from '../api/api-client.service';
import { CharacterRosterService } from './character-roster.service';
import { PersistenceService } from './persistence.service';
import { ProfileService } from './profile.service';

/** Serveur de jeu tel que servi par `GET /api/v1/game-servers` (table `game_servers`). */
export interface GameServer {
  code: string;
  label: string;
  isActive: boolean;
}

/**
 * Cache local de la liste. Volontairement **hors** des données synchronisées
 * (`USER_DATA_KEYS`) : ce n'est pas une donnée utilisateur mais une copie d'une
 * table serveur, qui n'a rien à faire ni dans le compte ni dans l'export RGPD.
 */
const SERVERS_CACHE_KEY = 'wakfu-game-servers';

/** D'où vient le serveur actif — sert à expliquer la déduction dans le tooltip du badge. */
export type ActiveServerSource = 'character' | 'default';

export interface ActiveServer {
  server: GameServer;
  source: ActiveServerSource;
  /** Personnage à l'origine de la déduction (`source === 'character'` uniquement). */
  characterName?: string;
}

/**
 * Serveur de jeu actif (lot 7, prompt 7.1).
 *
 * **Le log Wakfu ne dit jamais sur quel serveur on joue** (vérifié sur
 * `assets/logs/tests/fr/purchase_2.log`) : il faut donc le déclarer. La
 * conception retenue le rattache au **compte du roster**, pas à l'utilisateur —
 * un joueur multi-compte peut être réparti sur plusieurs serveurs, et c'est la
 * seule façon de le gérer sans lui demander de basculer un sélecteur à la main
 * à chaque changement de personnage.
 *
 * La déduction, par ordre de priorité :
 *
 * 1. le serveur du compte auquel appartient le **dernier personnage du roster
 *    reconnu dans le log** (factuel, aucune saisie) ;
 * 2. à défaut, le **serveur par défaut** du profil ;
 * 3. à défaut, `null` — et l'interface invite discrètement à le renseigner,
 *    sans jamais bloquer quoi que ce soit.
 *
 * Le personnage reconnu n'est **pas persisté** : il est de l'état dérivé du
 * fichier (principe d'architecture n°2 de CLAUDE.md), reconstruit à chaque
 * lecture. Une reconnexion relit tout le fichier et retrouve donc naturellement
 * le dernier personnage vu — le mettre à jour pendant `isInitialLoad` est ici
 * le comportement correct, contrairement aux compteurs de suivi.
 */
@Injectable({ providedIn: 'root' })
export class GameServerService {
  private readonly api = inject(ApiClientService);
  private readonly persistence = inject(PersistenceService);
  private readonly roster = inject(CharacterRosterService);
  private readonly profile = inject(ProfileService);

  /** Liste servie par l'API (jamais une liste en dur côté client, voir prompt 2.1). */
  readonly servers = signal<readonly GameServer[]>(
    this.persistence.getJson<GameServer[]>(SERVERS_CACHE_KEY) ?? [],
  );

  /** Dernier personnage du roster identifié dans le log — voir `noticeCharacter`. */
  private readonly lastKnownCharacter = signal<string | null>(null);

  /** Serveurs proposables dans les sélecteurs (un serveur désactivé côté base disparaît). */
  readonly selectableServers = computed(() => this.servers().filter((s) => s.isActive));

  readonly activeServer = computed<ActiveServer | null>(() => {
    const character = this.lastKnownCharacter();
    if (character) {
      const account = this.roster.findAccountByCharacter(character);
      const server = account?.gameServer ? this.resolveServer(account.gameServer) : undefined;
      // Un personnage reconnu dont le compte n'a pas de serveur renseigné ne
      // doit PAS faire croire au serveur par défaut d'un autre compte : mieux
      // vaut retomber sur le défaut global, explicitement signalé comme tel.
      if (server) return { server, source: 'character', characterName: character };
    }
    const fallback = this.profile.defaultGameServer();
    const server = fallback ? this.resolveServer(fallback) : undefined;
    return server ? { server, source: 'default' } : null;
  });

  /**
   * Charge la liste des serveurs. Échec réseau = on garde le cache local (ou
   * une liste vide) : l'application reste pleinement utilisable, seul le
   * sélecteur se retrouve sans options — jamais une liste inventée en dur pour
   * compenser.
   */
  async initialize(): Promise<void> {
    const result = await this.api.getJson<GameServer[]>('/game-servers');
    if (!result.ok || !Array.isArray(result.data)) return;
    this.servers.set(result.data);
    this.persistence.setJson(SERVERS_CACHE_KEY, result.data);
  }

  /**
   * Signale un nom de joueur croisé dans le log. Sans effet s'il n'appartient
   * à aucun compte déclaré — c'est le filtre qui rend la déduction fiable :
   * seuls les personnages que l'utilisateur a lui-même déclarés comptent,
   * jamais les autres joueurs présents dans un combat.
   */
  noticeCharacter(name: string): void {
    if (!this.roster.hasCharacter(name)) return;
    if (this.lastKnownCharacter() === name) return;
    this.lastKnownCharacter.set(name);
  }

  /** Le serveur actif ne peut être déduit de rien : l'interface le signale discrètement. */
  readonly needsSetup = computed(() => this.activeServer() === null);

  /**
   * Serveur correspondant à un code déjà choisi par l'utilisateur. Si la liste
   * n'a pas pu être chargée (premier lancement hors ligne, cache vide), on
   * fabrique une entrée à partir du seul code plutôt que de renvoyer
   * `undefined` : afficher « serveur non renseigné » alors que l'utilisateur
   * l'a bel et bien renseigné serait un mensonge, et taguerait l'historique du
   * lot 8 comme s'il n'y avait pas de serveur.
   *
   * Ce repli ne sert JAMAIS à proposer un choix (voir `selectableServers`, qui
   * ne lit que la liste réelle) — uniquement à afficher un code déjà stocké.
   */
  private resolveServer(code: string): GameServer {
    const known = this.servers().find((s) => s.code === code);
    if (known) return known;
    return { code, label: code.charAt(0).toUpperCase() + code.slice(1), isActive: true };
  }
}
