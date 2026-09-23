import { and, count, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { dungeons, fights, gameServers } from '../db/schema';

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

/**
 * Première référence inconnue du lot, sous forme de message d'erreur (400), ou `null` si tout
 * existe. Sans ce contrôle, un `gameServer` ou un `dungeonId` inexistant atteignait la clé
 * étrangère de l'`INSERT` et remontait en 500 — et, le lot étant écrit d'un bloc, faisait échouer
 * tous les autres événements avec lui, indéfiniment réessayés par la file cliente (un 5xx y est
 * « réessayable »). Un 400 est au contraire compté puis abandonné par la file (voir
 * `sync-queue.service.ts`), l'historique local restant intact.
 */
export function findUnknownReference(
  entries: readonly HistoryReferences[],
  known: KnownReferences,
): string | null {
  for (const entry of entries) {
    if (entry.gameServer !== null && !known.gameServers.has(entry.gameServer)) {
      return `gameServer inconnu : ${entry.gameServer}`;
    }
    if (entry.dungeonId != null && !known.dungeonIds.has(entry.dungeonId)) {
      return `dungeonId inconnu : ${entry.dungeonId}`;
    }
  }
  return null;
}

/** `findUnknownReference` sur les valeurs réellement en base — au plus deux petites lectures
 * indexées, et aucune quand le lot ne référence rien. */
export async function checkHistoryReferences(
  db: Db,
  entries: readonly HistoryReferences[],
): Promise<string | null> {
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
  return findUnknownReference(entries, {
    gameServers: new Set(serverRows.map((row) => row.code)),
    dungeonIds: new Set(dungeonRows.map((row) => row.id)),
  });
}

// ── Quota de combats par compte ─────────────────────────────────────────────────────────────────

/**
 * Nombre maximal de combats conservés par compte. Un joueur très actif en produit de l'ordre de
 * 100 à 300 par jour de jeu : 250 000 représente plusieurs années d'usage intensif, et borne le
 * volume qu'un seul compte (abusif, ou client bogué qui génère des `clientKey` toujours nouvelles)
 * peut faire peser sur la base Neon (0,5 Go sur le plan gratuit, `fight_participants` et
 * `fight_loot` compris). Seuls les combats sont bornés : c'est de loin la table la plus lourde
 * (participants + ventilation par sort en `jsonb`) ; achats, échanges et extractions restent
 * bornés par la limite de débit (`server/http/api-guards.ts`).
 */
export const MAX_FIGHTS_PER_ACCOUNT = 250_000;

/** Code d'erreur renvoyé (403) quand le quota est atteint — refus définitif pour la file cliente. */
export const HISTORY_QUOTA_EXCEEDED_CODE = 'history_quota_exceeded';

/** Vrai si écrire `newCount` combats de plus ferait dépasser `quota` à un compte qui en a `stored`. */
export function exceedsFightQuota(
  stored: number,
  newCount: number,
  quota: number = MAX_FIGHTS_PER_ACCOUNT,
): boolean {
  return newCount > 0 && stored + newCount > quota;
}

/**
 * `true` si le lot peut être écrit sans dépasser le quota. Deux lectures, toutes deux indexées :
 *
 * 1. les `clientKey` du lot déjà connues du compte (index unique `(user_id, client_key)`) — un
 *    renvoi de combats déjà stockés (rattachement de donjon a posteriori, correction de dégâts,
 *    relecture du fichier à la reconnexion) n'ajoute rien et passe toujours, même quota atteint ;
 * 2. seulement s'il y a du neuf : le nombre de combats du compte, compté dans une sous-requête
 *    `LIMIT quota + 1` — coût borné par le quota, jamais par la taille de la table, et
 *    négligeable pour l'immense majorité des comptes (quelques milliers de combats).
 */
export async function checkFightQuota(
  db: Db,
  userId: string,
  clientKeys: readonly string[],
  quota: number = MAX_FIGHTS_PER_ACCOUNT,
): Promise<boolean> {
  if (clientKeys.length === 0) return true;
  const [known] = await db
    .select({ value: count() })
    .from(fights)
    .where(and(eq(fights.userId, userId), inArray(fights.clientKey, [...clientKeys])));
  const newCount = clientKeys.length - Number(known?.value ?? 0);
  if (newCount <= 0) return true;

  const result = await db.execute(sql`
    select count(*) as stored from (
      select 1 from fights where user_id = ${userId} limit ${quota + 1}
    ) as bounded
  `);
  const stored = Number((result.rows[0] as { stored?: unknown } | undefined)?.stored ?? 0);
  return !exceedsFightQuota(stored, newCount, quota);
}
