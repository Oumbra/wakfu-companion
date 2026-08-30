import { Injectable, inject, signal } from '@angular/core';
import { CatalogService } from '../api/catalog.service';
import { EntityClassifierService } from '../services/entity-classifier.service';
import { GameServerService } from '../services/game-server.service';
import type { FightRecord, PurchaseRecord, TradeRecord } from '../services/stats-store.service';
import { findDungeonForEnemies } from '../utils/fight-image.util';
import { enemyCompositionKey, groupDungeonRuns } from '../utils/dungeon-run-grouping.util';
import {
  fightSignature,
  purchaseSignature,
  tradeSignature,
  type FightLootPayload,
  type FightParticipantPayload,
  type TradeItemPayload,
} from './history-event.model';
import { SyncQueueService } from './sync-queue.service';
import { SyncedFightsRegistry } from './synced-fights-registry.service';

/** Rattachement de donjon résolu pour un combat — voir `HistorySyncService.resolveDungeonAssignment`. */
interface DungeonAssignment {
  dungeonId: number | null;
  dungeonRunSignature: string | null;
  /** Les AUTRES combats du même run multi-salles (vide hors run, ou donjon à un seul combat) —
   * `recordFight` les renvoie aussi, pour propager un rattachement tout juste découvert à des
   * salles déjà envoyées (voir `functions/api/v1/history/fights.ts`, `onConflictDoUpdate`). */
  siblings: readonly FightRecord[];
}

/**
 * Traduit les enregistrements d'historique de `StatsStoreService` en événements
 * pour la file de synchronisation (lot 8, prompt 8.1).
 *
 * ## Ce service est un no-op complet en mode invité
 *
 * `StatsStoreService` l'appelle inconditionnellement, à chaque combat terminé,
 * chaque achat, chaque échange — y compris pendant un `isInitialLoad`. C'est
 * `SyncQueueService.isActive()` (donc `AuthService`) qui décide si quoi que ce
 * soit part. Aucun `if (connecté)` ne remonte ainsi jusqu'au store, comme
 * l'exige le §4 du plan.
 *
 * ## Pourquoi enfiler pendant `isInitialLoad` aussi
 *
 * Le gating `isInitialLoad` (principe d'architecture n°2 de CLAUDE.md) protège
 * les compteurs **persistants** d'un regonflage. Ici c'est l'inverse : une
 * (re)connexion reconstruit tout l'historique, et c'est précisément ce
 * contenu-là qu'il faut pouvoir envoyer — sinon un historique retrouvé après un
 * F5 ne partirait jamais. L'idempotence (clé dérivée du contenu, `UNIQUE (user_id,
 * client_key)`) est ce qui rend cet envoi systématique sans danger : c'est tout
 * le sujet du lot.
 */
@Injectable({ providedIn: 'root' })
export class HistorySyncService {
  private readonly queue = inject(SyncQueueService);
  private readonly classifier = inject(EntityClassifierService);
  private readonly catalog = inject(CatalogService);
  private readonly gameServer = inject(GameServerService);
  private readonly syncedFights = inject(SyncedFightsRegistry);

  /** Vrai quand le compte est connecté et que la file accepte des événements. */
  readonly enabled = signal(false);

  /** État de la file, pour l'affichage (page compte) — `'idle'` en mode invité. */
  readonly state = this.queue.state;
  readonly pendingCount = this.queue.pendingCount;
  readonly lastSyncedAt = this.queue.lastSyncedAt;

  /**
   * Rappel enregistré par `StatsStoreService` pour repasser l'historique déjà
   * reconstruit en mémoire au moment où la connexion aboutit — sans quoi une
   * connexion survenue **en cours de session** n'enverrait que les événements
   * suivants, et tout ce qui précède attendrait la prochaine relecture du
   * fichier.
   *
   * Un rappel explicite plutôt qu'un `effect()` sur `enabled` : le rejeu doit
   * partir immédiatement et de façon déterministe, pas au prochain cycle de
   * détection de changement.
   */
  private replaySource: (() => void) | null = null;

  setReplaySource(replay: () => void): void {
    this.replaySource = replay;
  }

  async enable(uid: string): Promise<void> {
    await this.queue.activate(uid);
    this.enabled.set(true);
    this.replaySource?.();
  }

  disable(): void {
    this.enabled.set(false);
    this.queue.deactivate();
  }

  /** Envoie immédiatement ce qui est en attente (bouton « Synchroniser maintenant »). */
  flush(): Promise<void> {
    return this.queue.flush();
  }

  /**
   * Le serveur de jeu résolu (lot 7), ou `null`. Un événement sans serveur
   * résolu part **quand même** (prompt 8.1 point 4) : le champ reste vide dans
   * l'historique affiché, plutôt que d'inventer une valeur ou de retenir
   * l'envoi.
   */
  private currentServer(): string | null {
    return this.gameServer.activeServer()?.server.code ?? null;
  }

  /** Construit la paire `itemId`/`itemName` mutuellement exclusive attendue par le serveur (voir
   * `FightLootPayload`) à partir du `catalogId` déjà résolu sur l'enregistrement (voir
   * `StatsStoreService.registerLoot`/`registerPurchase`/`registerTrade`, et `ItemPickerService`
   * pour la correction manuelle) — jamais recalculé ici, `catalogId` est la source de vérité unique. */
  private itemPayload(
    name: string,
    catalogId: number | null,
  ): { itemId: number | null; itemName: string | null } {
    return catalogId !== null
      ? { itemId: catalogId, itemName: null }
      : { itemId: null, itemName: name };
  }

  /** Miroir de itemPayload, côté monstre — voir FightParticipantPayload.monsterId. */
  private monsterId(name: string): number | null {
    return this.catalog.findWakfuMonsterEntry(name)?.id ?? null;
  }

  /** Construit la ventilation par participant envoyée au serveur — factorisé pour être appelé
   * aussi bien sur le combat à envoyer que, dans `recordFight`, sur sa copie déjà archivée (même
   * calcul des deux côtés = comparaison fiable, voir sa doc). */
  private buildParticipants(record: FightRecord): FightParticipantPayload[] {
    // L'XP est nommée dans le log exactement comme le combattant qui l'a
    // gagnée (`Caliburnus : +7 374 187 points d'XP.`) : elle se rattache donc
    // au participant. Un même nom ne peut pas recevoir deux gains distincts
    // dans un même combat (registerFightXp les cumule déjà).
    const xpByName = new Map(record.xp.map((row) => [row.name, row.amount]));

    return record.rows.map((row) => {
      const side = this.classifier.classify(row.name);
      return {
        side,
        name: row.name,
        monsterId: side === 'enemy' ? this.monsterId(row.name) : null,
        instanceIndex: row.instanceIndex,
        // La classe n'a de sens que pour un allié : `getDetectedClass` renvoie
        // une classe de personnage jouable, jamais une espèce de monstre.
        className: side === 'ally' ? (this.classifier.getDetectedClass(row.name) ?? null) : null,
        damage: Math.max(0, Math.round(row.total)),
        defeated: row.defeated,
        // Ventilation par sort et par élément : c'est l'essentiel de la valeur
        // d'un historique de combat, et c'est aussi ce qu'une réattribution
        // manuelle peut corriger après coup (d'où l'upsert côté serveur).
        // Plusieurs instances homonymes (`Nom#1`, `Nom#2`) : seule la première
        // porte l'XP, sans quoi le total du combat serait multiplié par le
        // nombre d'instances. Le cas ne concerne en pratique que des monstres,
        // qui n'en gagnent jamais.
        xpGained: row.instanceIndex === 1 ? (xpByName.get(row.name) ?? 0) : 0,
        spells: row.spells.map((spell) => ({
          spell: spell.spell,
          total: Math.max(0, Math.round(spell.total)),
          byElement: Object.fromEntries(
            Object.entries(spell.byElement).map(([element, amount]) => [
              element,
              Math.max(0, Math.round(amount ?? 0)),
            ]),
          ),
        })),
      };
    });
  }

  /** Miroir de buildParticipants, pour le butin — même raison d'être factorisé. */
  private buildLoot(record: FightRecord): FightLootPayload[] {
    return record.loot.map((row) => ({
      ...this.itemPayload(row.name, row.catalogId),
      quantity: row.quantity,
    }));
  }

  /**
   * `historyList` : historique de session connu au moment de l'appel, le plus RÉCENT en premier
   * (même convention que `StatsStoreService.fightHistoryList`/`groupDungeonRuns`) — sert à resituer
   * `record` parmi ses salles/boss de donjon éventuels. Passé explicitement plutôt qu'injecté
   * (StatsStoreService le détient déjà à chaque site d'appel) pour garder ce service testable sans
   * dépendre de l'ordre d'initialisation d'un store.
   */
  recordFight(record: FightRecord, historyList: readonly FightRecord[]): void {
    if (!this.queue.isActive()) return;

    const assignment = this.resolveDungeonAssignment(record, historyList);
    this.enqueueFight(record, assignment.dungeonId, assignment.dungeonRunSignature);
    // Propage un rattachement de donjon tout juste découvert aux salles déjà envoyées (voir doc de
    // DungeonAssignment) — même dungeonId/dungeonRunSignature pour tout le run, pas de recalcul :
    // un seul niveau de propagation, jamais de récursion sur les siblings d'un sibling.
    for (const sibling of assignment.siblings) {
      this.enqueueFight(sibling, assignment.dungeonId, assignment.dungeonRunSignature);
    }
  }

  /** Vrai si un archimonstre (`CatalogMonsterEntry.isArchi`) figure parmi les ennemis de `record` —
   * miroir de `FightHistoryComponent.hasArchiEnemy`, voir `hasPreBossArchi`/`groupDungeonRuns`. */
  private hasArchiEnemy(record: FightRecord): boolean {
    return record.rows.some(
      (row) =>
        this.classifier.classify(row.name) === 'enemy' &&
        this.catalog.findWakfuMonsterEntry(row.name)?.isArchi === true,
    );
  }

  /** Noms des ennemis de `record` — factorisé pour `findDungeonFor` ci-dessous ET la clé de
   * composition passée à `groupDungeonRuns` (voir `enemyCompositionKey`). */
  private enemyNamesFor(record: FightRecord): string[] {
    return record.rows
      .filter((row) => this.classifier.classify(row.name) === 'enemy')
      .map((row) => row.name);
  }

  /** Donjon dont `record` contient LUI-MÊME le boss (`null` sinon, y compris pour une simple salle
   * — voir `findDungeonForEnemies`) — miroir de `FightHistoryComponent`, même logique d'affichage. */
  private findDungeonFor(record: FightRecord): ReturnType<typeof findDungeonForEnemies> {
    return findDungeonForEnemies(this.catalog, this.enemyNamesFor(record));
  }

  /** Signature de contenu de `record`, réutilisée à la fois comme identité d'envoi (`clientKey`)
   * et, pour le combat représentatif d'un run, comme graine de `dungeonRunKey` (voir
   * `FightPayload.dungeonRunSignature`) — c'est ce qui fait que `dungeonRunKey` d'un run finit par
   * être exactement le `clientKey` du combat de boss. */
  private runSignature(record: FightRecord): string {
    return fightSignature({
      time: record.time,
      fightId: record.id,
      result: record.result,
      participants: record.rows,
    });
  }

  /**
   * Rattache `record` à un run de donjon au sein de `historyList`, avec le même algorithme que
   * l'affichage (`FightHistoryComponent`, voir dungeon-run-grouping.util.ts) :
   * 1. `record` fait partie d'un cluster multi-salles déjà résolu (`groupDungeonRuns` renvoie une
   *    entrée `dungeonRun` le contenant) : le donjon et la signature du combat REPRÉSENTATIF
   *    (le boss, potentiellement plus ancien que `record` lui-même si `record` est une salle) sont
   *    partagés par tout le cluster, renvoyé en entier via `siblings`.
   * 2. Sinon, `record` contient LUI-MÊME un boss de donjon (`findDungeonFor`) : soit un donjon à un
   *    seul combat (`dungeonRoomCount === 1`, jamais regroupé par construction — voir
   *    `groupDungeonRuns`), soit un cluster multi-salles collapsé faute de salles précédentes
   *    encore visibles (garde-fou « début d'historique », même fonction). Dans les deux cas,
   *    `record` est son propre représentant.
   * 3. Sinon (simple salle dont le boss n'est pas encore dans `historyList`, ou combat hors
   *    donjon) : aucun rattachement pour l'instant — `null`/`null`, à corriger plus tard (voir
   *    `functions/api/v1/history/fights.ts`, `onConflictDoUpdate` + `COALESCE`) quand le boss du
   *    run apparaîtra à son tour dans l'historique connu.
   */
  private resolveDungeonAssignment(
    record: FightRecord,
    historyList: readonly FightRecord[],
  ): DungeonAssignment {
    const entries = groupDungeonRuns(
      historyList,
      (r) => this.findDungeonFor(r),
      (r) => this.hasArchiEnemy(r),
      (r) => enemyCompositionKey(this.enemyNamesFor(r)),
    );

    const runEntry = entries.find(
      (entry) => entry.kind === 'dungeonRun' && entry.fights.some((f) => f.id === record.id),
    );
    if (runEntry?.kind === 'dungeonRun') {
      return {
        dungeonId: runEntry.dungeon.id,
        dungeonRunSignature: this.runSignature(runEntry.representative),
        siblings: runEntry.fights.filter((f) => f.id !== record.id),
      };
    }

    const own = this.findDungeonFor(record);
    return {
      dungeonId: own?.id ?? null,
      dungeonRunSignature: own ? this.runSignature(record) : null,
      siblings: [],
    };
  }

  private enqueueFight(
    record: FightRecord,
    dungeonId: number | null,
    dungeonRunSignature: string | null,
  ): void {
    const participants = this.buildParticipants(record);
    const loot = this.buildLoot(record);

    // Optimisation de trafic (pas de correction de doublon : celle-ci est déjà garantie côté
    // serveur par clientKey, voir history-event.model.ts) : si l'archive du compte connaît déjà
    // CE combat (même identité de contenu, voir fightDedupKey) avec EXACTEMENT la même ventilation
    // par participant et le même butin, il n'y a rien de nouveau à envoyer — évite de renvoyer
    // tout l'historique reconstruit à chaque (re)connexion (principe d'architecture n°2, CLAUDE.md)
    // alors que la quasi-totalité est déjà connue du compte. Une VRAIE différence (réattribution
    // manuelle de dégâts ou d'objet, voir reassignSpell/reassignLootItem) fait forcément diverger
    // participants/loot de la copie archivée : jamais silencieusement perdue par ce court-circuit.
    // `syncedFights` n'est alimenté que par ce que l'archive a déjà chargé (best-effort, voir sa
    // doc) : un combat pas encore vu ici part simplement comme avant.
    //
    // Ce court-circuit ne s'applique QUE si ce combat n'apporte aucune information de donjon
    // nouvelle (`dungeonId === null`) : sinon, il doit repartir même si participants/loot sont
    // inchangés, pour que le serveur apprenne dungeonId/dungeonRunKey (cas d'une salle déjà connue
    // du compte, renvoyée uniquement pour son rattachement — voir `recordFight`).
    if (dungeonId === null) {
      const archived = this.syncedFights.get(record);
      if (archived) {
        const archivedParticipants = this.buildParticipants(archived);
        const archivedLoot = this.buildLoot(archived);
        if (
          JSON.stringify(participants) === JSON.stringify(archivedParticipants) &&
          JSON.stringify(loot) === JSON.stringify(archivedLoot)
        ) {
          return;
        }
      }
    }

    const signature = this.runSignature(record);

    this.queue.enqueue({
      id: `fight:${signature}`,
      kind: 'fight',
      signature,
      payload: {
        // Purement diagnostique côté serveur (fights.fightLogId) — voir sa doc. `archiveId()`
        // (HistoryArchiveService) attribue toujours un id négatif à un combat reconstruit depuis
        // l'archive, jamais un vrai fightId de log (toujours positif, voir sa propre doc) : ce
        // renvoi de correction n'a simplement plus le fightId d'origine à transmettre.
        fightId: record.id > 0 ? record.id : null,
        startedAt: new Date(record.fullTimestampMs).toISOString(),
        durationMs: record.durationMs,
        won: record.result === 'won',
        turns: record.turns,
        // Dégâts de l'équipe du joueur : la somme des lignes classées alliées.
        // Additionner les deux camps donnerait un total sans signification (les
        // dégâts subis et infligés y seraient mélangés).
        totalDamage: participants
          .filter((participant) => participant.side === 'ally')
          .reduce((sum, participant) => sum + participant.damage, 0),
        xpGained: record.xp.reduce((sum, row) => sum + row.amount, 0),
        kamasGained: record.kamas,
        gameServer: this.currentServer(),
        dungeonId,
        dungeonRunSignature,
        challengesPassed: record.challengesPassed,
        challengesFailed: record.challengesFailed,
        participants,
        loot,
      },
    });
  }

  recordPurchase(record: PurchaseRecord): void {
    if (!this.queue.isActive()) return;

    const signature = purchaseSignature({
      time: record.time,
      item: record.item,
      quantity: record.quantity,
      totalCost: record.totalCost,
    });

    this.queue.enqueue({
      id: `purchase:${signature}`,
      kind: 'purchase',
      signature,
      payload: {
        ...this.itemPayload(record.item, record.catalogId),
        quantity: record.quantity,
        totalCost: record.totalCost,
        occurredAt: new Date(record.fullTimestampMs).toISOString(),
        gameServer: this.currentServer(),
      },
    });
  }

  recordTrade(record: TradeRecord): void {
    if (!this.queue.isActive()) return;

    const items: TradeItemPayload[] = [
      ...record.acquired.map((item) => ({
        direction: 'acquired' as const,
        ...this.itemPayload(item.name, item.catalogId),
        quantity: item.quantity,
      })),
      ...record.given.map((item) => ({
        direction: 'given' as const,
        ...this.itemPayload(item.name, item.catalogId),
        quantity: item.quantity,
      })),
    ];

    // Le nom brut (jamais `null`, contrairement à `TradeItemPayload.itemName` une fois l'id résolu)
    // vient directement des records d'origine, pas du payload déjà construit ci-dessus — voir
    // `itemPayload`, qui vide `itemName` dès que `catalogId` est connu.
    const signature = tradeSignature({
      time: record.time,
      peerName: record.characterName,
      selfName: record.selfName,
      kamasAcquired: record.kamasAcquired,
      kamasGiven: record.kamasGiven,
      items: [
        ...record.acquired.map((item) => ({
          direction: 'acquired' as const,
          name: item.name,
          quantity: item.quantity,
        })),
        ...record.given.map((item) => ({
          direction: 'given' as const,
          name: item.name,
          quantity: item.quantity,
        })),
      ],
    });

    this.queue.enqueue({
      id: `trade:${signature}`,
      kind: 'trade',
      signature,
      payload: {
        peerName: record.characterName,
        selfName: record.selfName,
        occurredAt: new Date(record.fullTimestampMs).toISOString(),
        kamasAcquired: record.kamasAcquired,
        kamasGiven: record.kamasGiven,
        gameServer: this.currentServer(),
        items,
      },
    });
  }
}
