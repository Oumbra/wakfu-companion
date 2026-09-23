import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accountStorage } from '../db/schema';
import { findKnownClientKeys, type QuotaTable } from './guards';

/**
 * Budget de STOCKAGE de l'historique (audit de sécurité du 2026-09-23, lot 6) — en complément des
 * quotas en lignes (`guards.ts`) et de la limite de débit en octets (`HISTORY_WRITE_BYTES_RULE`,
 * `server/http/api-guards.ts`) :
 *
 * - **par compte** : `MAX_HISTORY_BYTES_PER_ACCOUNT`, compté dans `account_storage` ;
 * - **global** : au-delà de `HISTORY_STORAGE_CEILING_MB` (taille de la base), plus aucune écriture
 *   d'historique n'est acceptée — l'espace restant est gardé pour les comptes, sessions et
 *   réglages, qui continuent de fonctionner. Sans ce coupe-circuit, une base pleine bloquait toutes
 *   les écritures, connexions comprises.
 */

/**
 * Volume maximal d'historique par compte. Un combat réel pèse quelques Ko de JSON : 64 Mio couvrent
 * des dizaines de milliers de combats, et bornent à une fraction de la base (0,5 Go sur le plan
 * gratuit) ce qu'un compte abusif peut occuper. À relever avec le plan Neon.
 */
export const MAX_HISTORY_BYTES_PER_ACCOUNT = 64 * 1024 * 1024;

/** Plafond par défaut de la base, en Mo, au-delà duquel les écritures d'historique sont refusées
 * (plan gratuit Neon : 512 Mo). Surchargeable par la variable `HISTORY_STORAGE_CEILING_MB`. */
export const DEFAULT_HISTORY_STORAGE_CEILING_MB = 450;

/** Taille d'une entrée telle que comptée dans le budget : son JSON (≈ octets pour du texte ASCII,
 * cas de l'immense majorité du contenu d'un combat). */
export function entryBytes(entry: unknown): number {
  return JSON.stringify(entry).length;
}

/** Vrai si écrire `bytes` de plus fait dépasser le budget d'un compte qui en a `stored`. */
export function exceedsStorageBudget(
  stored: number,
  bytes: number,
  budget: number = MAX_HISTORY_BYTES_PER_ACCOUNT,
): boolean {
  return bytes > 0 && stored + bytes > budget;
}

export async function storedHistoryBytes(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ bytes: accountStorage.historyBytes })
    .from(accountStorage)
    .where(eq(accountStorage.userId, userId));
  return row?.bytes ?? 0;
}

/** Ajoute `bytes` au volume du compte (upsert atomique, une requête). */
export async function chargeHistoryBytes(db: Db, userId: string, bytes: number): Promise<void> {
  if (bytes <= 0) return;
  await db
    .insert(accountStorage)
    .values({ userId, historyBytes: bytes, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: accountStorage.userId,
      set: {
        historyBytes: sql`${accountStorage.historyBytes} + ${bytes}`,
        updatedAt: sql`now()`,
      },
    });
}

/** Plafond effectif, en octets, lu dans l'environnement (valeur invalide ⇒ défaut). */
export function storageCeilingBytes(raw: string | undefined): number {
  const mb = Number(raw);
  return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_HISTORY_STORAGE_CEILING_MB) * 1024 * 1024;
}

/** Taille de la base mise en cache par isolate : une lecture par minute au plus, pas une par
 * requête. */
const SIZE_CACHE_MS = 60_000;
let cachedSize: { bytes: number; at: number } | null = null;

/**
 * Vrai si la base a atteint le plafond. Une erreur de lecture ne bloque jamais l'écriture (le
 * coupe-circuit protège la disponibilité, il ne doit pas en devenir une panne).
 */
export async function isHistoryStorageFull(
  db: Db,
  ceilingBytes: number,
  now: number = Date.now(),
): Promise<boolean> {
  if (!cachedSize || now - cachedSize.at > SIZE_CACHE_MS) {
    try {
      const result = await db.execute(sql`select pg_database_size(current_database()) as size`);
      const size = Number((result.rows[0] as { size?: unknown } | undefined)?.size ?? 0);
      cachedSize = { bytes: size, at: now };
    } catch (error) {
      console.error('[storage] taille de la base illisible', error);
      return false;
    }
  }
  return cachedSize.bytes >= ceilingBytes;
}

/** Dépendances `storage` de `processHistoryBatch` (batch.ts) pour une table d'historique. */
export function historyStorageDeps(
  db: Db,
  table: QuotaTable,
  userId: string,
  ceilingMb: string | undefined,
) {
  return {
    isFull: () => isHistoryStorageFull(db, storageCeilingBytes(ceilingMb)),
    storedBytes: () => storedHistoryBytes(db, userId),
    knownClientKeys: (clientKeys: readonly string[]) =>
      findKnownClientKeys(db, table, userId, clientKeys),
    charge: (bytes: number) => chargeHistoryBytes(db, userId, bytes),
  };
}
