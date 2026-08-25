import { Injectable } from '@angular/core';
import type { FightRecord } from '../services/stats-store.service';
import { fightDedupKey } from './history-dedup.util';

/**
 * Registre des combats déjà connus de l'archive du compte, indexés par `fightDedupKey` — sert
 * uniquement à éviter de renvoyer inutilement à `POST /history/fights` un combat qui n'a
 * strictement rien de nouveau (voir `HistorySyncService.recordFight`).
 *
 * Volontairement un service à part, ni dans `HistoryArchiveService` ni dans `HistorySyncService` :
 * ces deux-là dépendent déjà l'un de l'autre dans un sens (`HistoryArchiveService` injecte
 * `HistorySyncService` pour renvoyer une correction, voir `reassignLootItem`) — les faire dépendre
 * l'un de l'autre dans les DEUX sens créerait un cycle de dépendances Angular. Ce registre est le
 * point neutre entre les deux : `HistoryArchiveService` l'alimente au chargement d'une page
 * d'archive, `HistorySyncService` le consulte avant d'enfiler un envoi.
 *
 * Alimentation **best-effort** : l'archive n'est chargée qu'à la demande (page Historique visitée,
 * ou `loadAll()` au moment de la connexion) — un combat pas encore vu ici n'est simplement pas
 * reconnu, et part normalement (le serveur reste de toute façon idempotent via `clientKey`, voir
 * `history-event.model.ts`). Ce registre n'est donc jamais une source de vérité, juste une
 * optimisation de trafic : le pire cas d'un registre incomplet ou périmé est un envoi superflu
 * mais sans danger, jamais une perte de donnée.
 */
@Injectable({ providedIn: 'root' })
export class SyncedFightsRegistry {
  private readonly byKey = new Map<string, FightRecord>();

  /** Le combat déjà archivé partageant la même identité de contenu que `record` (même heure de
   * fin, même résultat, mêmes participants) — voir `fightDedupKey`. `undefined` si ce combat
   * n'est pas (encore) connu de l'archive chargée. */
  get(record: Pick<FightRecord, 'time' | 'result' | 'rows'>): FightRecord | undefined {
    return this.byKey.get(fightDedupKey(record));
  }

  register(records: readonly FightRecord[]): void {
    for (const record of records) this.byKey.set(fightDedupKey(record), record);
  }

  /** Déconnexion, ou resynchronisation manuelle qui invalide ce qui était connu. */
  reset(): void {
    this.byKey.clear();
  }
}
