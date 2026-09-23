import type { IngestResult } from './ingest';
import type { KnownReferences, HistoryReferences } from './guards';
import { HISTORY_QUOTA_EXCEEDED_CODE, historyQuotaExceededBody, splitByReferences } from './guards';
import { MAX_HISTORY_BYTES_PER_ACCOUNT, entryBytes } from './storage';
import type { ParseResult, ParsedBatch, RejectedEntry } from './parse';

/**
 * Déroulé commun des quatre `POST /api/v1/history/*` APRÈS authentification, limite de débit et
 * lecture bornée du corps : validation par entrée, références, quota, écriture, réponse. Sorti des
 * handlers pour être testé sans base ni runtime Pages (`batch.spec.ts`) — les accès base sont
 * injectés (`HistoryBatchDeps`).
 *
 * ## Contrat de réponse (correctif du 2026-09-23)
 *
 * - **400** : corps GLOBALEMENT malformé seulement (pas de tableau `entries`, lot > `MAX_HISTORY_BATCH`
 *   — le JSON invalide et le corps trop gros sont refusés plus tôt, par `readJsonBodyLimited`).
 * - **403 `history_quota_exceeded`** : le lot ferait dépasser le quota du compte — lot refusé en
 *   entier, comme avant (le client web cesse d'envoyer, voir `sync-queue.service.ts`).
 * - **200** dans tous les autres cas, y compris quand des entrées sont invalides : elles sont
 *   IGNORÉES (jamais écrites) et listées dans `rejected: [{ index, clientKey?, error }]`, champ
 *   ADDITIF — `accepted`/`inserted` gardent leur sens (clés des entrées écrites, lignes insérées ou
 *   mises à jour). Les deux clients existants ne lisent que le statut (site) et `inserted` (journal
 *   de l'overlay) : aucun ne casse, et une entrée invalide ne bloque plus jamais leur file.
 */

export interface HistoryBatchResponse extends IngestResult {
  rejected: RejectedEntry[];
}

export type HistoryBatchOutcome =
  | { status: 200; body: HistoryBatchResponse }
  | { status: 400; body: { error: string } }
  | { status: 403; body: { error: string; code: string } }
  | { status: 503; body: { error: string; code: string } };

/**
 * Taille maximale d'UNE entrée (son JSON), audit de sécurité du 2026-09-23, lot 6. Un combat réel
 * pèse quelques Ko ; les bornes de forme de `parse.ts` (128 participants × 64 sorts × 16 éléments)
 * en autorisaient plusieurs centaines. Une entrée plus grosse est ignorée (listée dans `rejected`),
 * comme toute entrée invalide — jamais le lot entier.
 */
export const MAX_HISTORY_ENTRY_BYTES = 64 * 1024;

/** Code de la réponse 503 quand la base a atteint son plafond : réessayable côté client. */
export const HISTORY_STORAGE_FULL_CODE = 'history_storage_full';

export interface HistoryBatchSpec<T> {
  parse: (body: unknown, now: Date) => ParseResult<ParsedBatch<T>>;
  /** Libellé du quota dans le message d'erreur (« de combats », « d'achats »...). */
  quotaLabel: string;
  quota: number;
}

export interface HistoryBatchDeps<T> {
  loadKnownReferences: (entries: readonly T[]) => Promise<KnownReferences>;
  /** `true` si le lot (ses `clientKey`) tient dans le quota — voir `checkHistoryQuota`. */
  withinQuota: (clientKeys: readonly string[]) => Promise<boolean>;
  ingest: (entries: readonly T[]) => Promise<IngestResult>;
  /**
   * Budget de stockage (server/history/storage.ts). Facultatif pour les tests qui ne le visent
   * pas ; les quatre routes le fournissent toujours.
   */
  storage?: {
    /** Vrai si la base a atteint son plafond global. */
    isFull: () => Promise<boolean>;
    /** `clientKey` du lot déjà stockées : leur renvoi n'ajoute rien au volume. */
    knownClientKeys: (clientKeys: readonly string[]) => Promise<ReadonlySet<string>>;
    /**
     * Réserve `bytes` sur le volume du compte, en une écriture conditionnelle : `false` si cela
     * dépasse le budget. Atomique (audit du 2026-09-23, S8) : deux lots concurrents ne peuvent
     * plus lire le même volume puis le dépasser ensemble.
     */
    reserve: (bytes: number) => Promise<boolean>;
    /** Rend une réservation dont l'écriture a échoué. */
    release: (bytes: number) => Promise<void>;
  };
}

export async function processHistoryBatch<T extends HistoryReferences & { clientKey: string }>(
  body: unknown,
  now: Date,
  spec: HistoryBatchSpec<T>,
  deps: HistoryBatchDeps<T>,
): Promise<HistoryBatchOutcome> {
  const parsed = spec.parse(body, now);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

  let batch = withoutOversizedEntries(parsed.value);
  if (batch.entries.length > 0) {
    // Référence inconnue ⇒ entrée ignorée plutôt qu'une violation de clé étrangère en 500.
    batch = splitByReferences(batch, await deps.loadKnownReferences(batch.entries));
  }
  if (batch.entries.length === 0) {
    return { status: 200, body: { accepted: [], inserted: 0, rejected: batch.rejected } };
  }

  if (!(await deps.withinQuota(batch.entries.map((entry) => entry.clientKey)))) {
    return { status: 403, body: historyQuotaExceededBody(spec.quotaLabel, spec.quota) };
  }

  // Budget de stockage : seules les entrées NOUVELLES pèsent (un renvoi d'événements déjà stockés
  // passe toujours, comme pour le quota en lignes).
  let newBytes = 0;
  if (deps.storage) {
    const known = await deps.storage.knownClientKeys(batch.entries.map((e) => e.clientKey));
    newBytes = batch.entries
      .filter((entry) => !known.has(entry.clientKey))
      .reduce((sum, entry) => sum + entryBytes(entry), 0);
    if (newBytes > 0) {
      if (await deps.storage.isFull()) {
        return {
          status: 503,
          body: {
            error: 'stockage de l’historique momentanément plein',
            code: HISTORY_STORAGE_FULL_CODE,
          },
        };
      }
      if (!(await deps.storage.reserve(newBytes))) {
        return {
          status: 403,
          body: {
            error: `volume d'historique atteint (${MAX_HISTORY_BYTES_PER_ACCOUNT} octets par compte)`,
            code: HISTORY_QUOTA_EXCEEDED_CODE,
          },
        };
      }
    }
  }

  let result: IngestResult;
  try {
    result = await deps.ingest(batch.entries);
  } catch (error) {
    if (deps.storage && newBytes > 0) await deps.storage.release(newBytes).catch(() => undefined);
    throw error;
  }
  return { status: 200, body: { ...result, rejected: batch.rejected } };
}

/** Écarte (dans `rejected`) les entrées dont le JSON dépasse `MAX_HISTORY_ENTRY_BYTES`. */
function withoutOversizedEntries<T extends { clientKey: string }>(
  batch: ParsedBatch<T>,
): ParsedBatch<T> {
  const result: ParsedBatch<T> = { entries: [], indices: [], rejected: [...batch.rejected] };
  batch.entries.forEach((entry, i) => {
    const size = entryBytes(entry);
    if (size > MAX_HISTORY_ENTRY_BYTES) {
      result.rejected.push({
        index: batch.indices[i],
        clientKey: entry.clientKey,
        error: `entrée trop volumineuse (${size} octets, maximum ${MAX_HISTORY_ENTRY_BYTES})`,
      });
      return;
    }
    result.entries.push(entry);
    result.indices.push(batch.indices[i]);
  });
  result.rejected.sort((a, b) => a.index - b.index);
  return result;
}
