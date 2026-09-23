import { and, count, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { dungeons, fights, gameServers, pactExtractions, purchases, trades } from '../db/schema';
import { echoValue, type ParsedBatch } from './parse';

/**
 * Contrôles d'un lot d'historique DÉJÀ validé en forme (`parse.ts`), qui demandent la base —
 * appelés par les handlers `POST /api/v1/history/*` juste avant l'écriture (`ingest.ts`).
 * Correctif du 2026-09-23 (audit sécurité/DoS). Les décisions sont des fonctions pures, testées
 * dans `guards.spec.ts` ; seules les lectures SQL restent ici.
 */

// ── Références (clés étrangères) ────────────────────────────────────────────────────────────────

/** Ce qu'un lot référence : un code `game_servers` et, pour un combat, un id `dungeons`. */
export interface HistoryReferences {
  gameServer: string | null;
  dungeonId?: number | null;
}

export interface KnownReferences {
  gameServers: ReadonlySet<string>;
  dungeonIds: ReadonlySet<number>;
}

/** Message d'erreur de la première référence inconnue d'UNE entrée, ou `null` si tout existe. */
function unknownReferenceOf(entry: HistoryReferences, known: KnownReferences): string | null {
  if (entry.gameServer !== null && !known.gameServers.has(entry.gameServer)) {
    return `gameServer inconnu : ${echoValue(entry.gameServer)}`;
  }
  if (entry.dungeonId != null && !known.dungeonIds.has(entry.dungeonId)) {
    return `dungeonId inconnu : ${entry.dungeonId}`;
  }
  return null;
}

/**
 * Première référence inconnue du lot, sous forme de message d'erreur, ou `null` si tout existe.
 * Sans ce contrôle, un `gameServer` ou un `dungeonId` inexistant atteignait la clé étrangère de
 * l'`INSERT` et remontait en 500 — et, le lot étant écrit d'un bloc, faisait échouer tous les
 * autres événements avec lui.
 */
export function findUnknownReference(
  entries: readonly HistoryReferences[],
  known: KnownReferences,
): string | null {
  for (const entry of entries) {
    const error = unknownReferenceOf(entry, known);
    if (error) return error;
  }
  return null;
}

/**
 * Sépare un lot DÉJÀ validé en forme (`ParsedBatch`, parse.ts) selon ses références : les entrées
 * dont une référence est inconnue rejoignent `rejected` (ignorées, jamais écrites) au lieu de faire
 * refuser tout le lot — même sémantique par entrée que la validation de forme (correctif du
 * 2026-09-23, voir `parseBatchLenient`). Pure : testée dans `guards.spec.ts`.
 */
export function splitByReferences<T extends HistoryReferences & { clientKey: string }>(
  batch: ParsedBatch<T>,
  known: KnownReferences,
): ParsedBatch<T> {
  const result: ParsedBatch<T> = { entries: [], indices: [], rejected: [...batch.rejected] };
  batch.entries.forEach((entry, i) => {
    const error = unknownReferenceOf(entry, known);
    if (error) {
      result.rejected.push({ index: batch.indices[i], clientKey: entry.clientKey, error });
      return;
    }
    result.entries.push(entry);
    result.indices.push(batch.indices[i]);
  });
  result.rejected.sort((a, b) => a.index - b.index);
  return result;
}

/** Références du lot réellement présentes en base — au plus deux petites lectures indexées, et
 * aucune quand le lot ne référence rien. */
export async function loadKnownReferences(
  db: Db,
  entries: readonly HistoryReferences[],
): Promise<KnownReferences> {
  const wantedServers = new Set<string>();
  const wantedDungeons = new Set<number>();
  for (const entry of entries) {
    if (entry.gameServer !== null) wantedServers.add(entry.gameServer);
    if (entry.dungeonId != null) wantedDungeons.add(entry.dungeonId);
  }
  const [serverRows, dungeonRows] = await Promise.all([
    wantedServers.size > 0
      ? db
          .select({ code: gameServers.code })
          .from(gameServers)
          .where(inArray(gameServers.code, [...wantedServers]))
      : Promise.resolve([]),
    wantedDungeons.size > 0
      ? db
          .select({ id: dungeons.id })
          .from(dungeons)
          .where(inArray(dungeons.id, [...wantedDungeons]))
      : Promise.resolve([]),
  ]);
  return {
    gameServers: new Set(serverRows.map((row) => row.code)),
    dungeonIds: new Set(dungeonRows.map((row) => row.id)),
  };
}

// ── Quotas d'historique par compte ──────────────────────────────────────────────────────────────

/**
 * Nombre maximal de combats conservés par compte. Un joueur très actif en produit de l'ordre de
 * 100 à 300 par jour de jeu : 250 000 représente plusieurs années d'usage intensif, et borne le
 * volume qu'un seul compte (abusif, ou client bogué qui génère des `clientKey` toujours nouvelles)
 * peut faire peser sur la base Neon (0,5 Go sur le plan gratuit, `fight_participants` et
 * `fight_loot` compris).
 */
export const MAX_FIGHTS_PER_ACCOUNT = 250_000;

/**
 * Quotas des trois autres historiques (correctif du 2026-09-23, audit sécurité #2) : jusque-là
 * bornés par la seule limite de débit (600 lots de 100 par 10 min, soit des millions de lignes par
 * jour pour un client qui fabrique des `clientKey` toujours nouvelles). 500 000 chacun est très
 * au-delà de tout usage réel (quelques achats/échanges/extractions par session de jeu) : la borne
 * ne vise que l'abus.
 */
export const MAX_PURCHASES_PER_ACCOUNT = 500_000;
export const MAX_TRADES_PER_ACCOUNT = 500_000;
export const MAX_PACT_EXTRACTIONS_PER_ACCOUNT = 500_000;

/** Code d'erreur renvoyé (403) quand un quota est atteint — refus définitif pour la file cliente. */
export const HISTORY_QUOTA_EXCEEDED_CODE = 'history_quota_exceeded';

/** Vrai si écrire `newCount` lignes de plus ferait dépasser `quota` à un compte qui en a `stored`. */
export function exceedsHistoryQuota(stored: number, newCount: number, quota: number): boolean {
  return newCount > 0 && stored + newCount > quota;
}

/** Variante historique, quota des combats par défaut. */
export function exceedsFightQuota(
  stored: number,
  newCount: number,
  quota: number = MAX_FIGHTS_PER_ACCOUNT,
): boolean {
  return exceedsHistoryQuota(stored, newCount, quota);
}

/** Tables d'historique soumises à quota : toutes portent `user_id` et `client_key`, avec un index
 * unique `(user_id, client_key)` qui sert aux deux lectures de `checkHistoryQuota`. */
export type QuotaTable = typeof fights | typeof purchases | typeof trades | typeof pactExtractions;

/**
 * `true` si le lot peut être écrit sans dépasser le quota de `table`. Deux lectures, toutes deux
 * indexées :
 *
 * 1. les `clientKey` du lot déjà connues du compte (index unique `(user_id, client_key)`) — un
 *    renvoi d'événements déjà stockés (rattachement de donjon a posteriori, correction de dégâts
 *    ou d'objet, relecture du fichier à la reconnexion) n'ajoute rien et passe toujours, même
 *    quota atteint ;
 * 2. seulement s'il y a du neuf : le nombre de lignes du compte, compté dans une sous-requête
 *    `LIMIT quota + 1` — coût borné par le quota, jamais par la taille de la table.
 */
export async function checkHistoryQuota(
  db: Db,
  table: QuotaTable,
  userId: string,
  clientKeys: readonly string[],
  quota: number,
): Promise<boolean> {
  if (clientKeys.length === 0) return true;
  const [known] = await db
    .select({ value: count() })
    .from(table)
    .where(and(eq(table.userId, userId), inArray(table.clientKey, [...clientKeys])));
  const newCount = clientKeys.length - Number(known?.value ?? 0);
  if (newCount <= 0) return true;

  const result = await db.execute(sql`
    select count(*) as stored from (
      select 1 from ${table} where ${table.userId} = ${userId} limit ${quota + 1}
    ) as bounded
  `);
  const stored = Number((result.rows[0] as { stored?: unknown } | undefined)?.stored ?? 0);
  return !exceedsHistoryQuota(stored, newCount, quota);
}

/** `checkHistoryQuota` sur les combats (API d'origine, conservée). */
export function checkFightQuota(
  db: Db,
  userId: string,
  clientKeys: readonly string[],
  quota: number = MAX_FIGHTS_PER_ACCOUNT,
): Promise<boolean> {
  return checkHistoryQuota(db, fights, userId, clientKeys, quota);
}

/** Corps de la réponse 403 d'un quota atteint — même forme pour les quatre historiques (le client
 * web reconnaît `code`, voir `sync-queue.service.ts`). */
export function historyQuotaExceededBody(
  label: string,
  quota: number,
): {
  error: string;
  code: string;
} {
  return {
    error: `quota ${label} atteint (${quota} par compte)`,
    code: HISTORY_QUOTA_EXCEEDED_CODE,
  };
}
