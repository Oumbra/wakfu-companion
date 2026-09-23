import type { IngestResult } from './ingest';
import type { KnownReferences, HistoryReferences } from './guards';
import { historyQuotaExceededBody, splitByReferences } from './guards';
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
  | { status: 403; body: { error: string; code: string } };

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
}

export async function processHistoryBatch<T extends HistoryReferences & { clientKey: string }>(
  body: unknown,
  now: Date,
  spec: HistoryBatchSpec<T>,
  deps: HistoryBatchDeps<T>,
): Promise<HistoryBatchOutcome> {
  const parsed = spec.parse(body, now);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

  let batch = parsed.value;
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

  const result = await deps.ingest(batch.entries);
  return { status: 200, body: { ...result, rejected: batch.rejected } };
}
