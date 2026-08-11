import { Injectable, inject, signal } from '@angular/core';
import { CatalogService } from '../api/catalog.service';
import { EntityClassifierService } from '../services/entity-classifier.service';
import { GameServerService } from '../services/game-server.service';
import type { FightRecord, PurchaseRecord, TradeRecord } from '../services/stats-store.service';
import {
  fightSignature,
  purchaseSignature,
  tradeSignature,
  type FightParticipantPayload,
  type TradeItemPayload,
} from './history-event.model';
import { SyncQueueService } from './sync-queue.service';

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

  private itemId(name: string): number | null {
    return this.catalog.findWakfuItemEntry(name)?.id ?? null;
  }

  recordFight(record: FightRecord): void {
    if (!this.queue.isActive()) return;

    const participants: FightParticipantPayload[] = record.rows.map((row) => {
      const side = this.classifier.classify(row.name);
      return {
        side,
        name: row.name,
        instanceIndex: row.instanceIndex,
        // La classe n'a de sens que pour un allié : `getDetectedClass` renvoie
        // une classe de personnage jouable, jamais une espèce de monstre.
        className: side === 'ally' ? (this.classifier.getDetectedClass(row.name) ?? null) : null,
        damage: Math.max(0, Math.round(row.total)),
        defeated: row.defeated,
        // Ventilation par sort et par élément : c'est l'essentiel de la valeur
        // d'un historique de combat, et c'est aussi ce qu'une réattribution
        // manuelle peut corriger après coup (d'où l'upsert côté serveur).
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

    const signature = fightSignature({
      time: record.time,
      fightId: record.id,
      result: record.result,
      participants: record.rows,
    });

    this.queue.enqueue({
      id: `fight:${signature}`,
      kind: 'fight',
      signature,
      payload: {
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
        // Le log ne rattache jamais un gain de kamas à un combat (voir
        // `KamaGainEntry`, sans `fightId`) : la colonne reste vide plutôt que de
        // recevoir une valeur devinée.
        kamasGained: null,
        gameServer: this.currentServer(),
        participants,
        loot: record.loot.map((row) => ({
          itemId: this.itemId(row.name),
          itemName: row.name,
          quantity: row.quantity,
        })),
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
        itemId: this.itemId(record.item),
        itemName: record.item,
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
        itemId: this.itemId(item.name),
        itemName: item.name,
        quantity: item.quantity,
      })),
      ...record.given.map((item) => ({
        direction: 'given' as const,
        itemId: this.itemId(item.name),
        itemName: item.name,
        quantity: item.quantity,
      })),
    ];

    const signature = tradeSignature({
      time: record.time,
      peerName: record.characterName,
      selfName: record.selfName,
      kamasAcquired: record.kamasAcquired,
      kamasGiven: record.kamasGiven,
      items: items.map((item) => ({
        direction: item.direction,
        name: item.itemName,
        quantity: item.quantity,
      })),
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
