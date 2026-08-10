import type { PagesFunction } from '@cloudflare/workers-types';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { createDb } from '../../../server/db/client';
import { userSettings } from '../../../server/db/schema';
import { isSyncedSettingKey } from '../../../server/settings/keys';
import { parsePatchBody, resolveWrites } from '../../../server/settings/merge';
import { authenticate, json, jsonError, requireCsrf, unauthenticated } from '../_auth';
import type { Env } from '../_types';

/**
 * Configuration utilisateur (`user_settings`) — lot 6, prompt 6.1.
 *
 * Trois verbes, deux usages bien distincts :
 *
 * - `GET` — état complet du compte, valeurs **et** horodatage par clé. C'est
 *   `updatedAtByKey` qui rend l'arbitrage « dernier écrivain gagne » possible
 *   côté client ; l'`updatedAt` global (le plus récent) ne sert plus qu'à
 *   l'affichage.
 * - `PATCH` — écriture **par clé**, avec arbitrage (voir
 *   `server/settings/merge.ts`). C'est le chemin normal de la synchronisation
 *   au fil de l'eau.
 * - `PUT` — remplacement **complet**, hérité du lot 5 : c'est le « téléverser
 *   mes données locales » de l'écran de migration, où l'utilisateur a
 *   explicitement tranché quelle source garder. Volontairement sans
 *   arbitrage : écraser est justement ce qui est demandé.
 *
 * Le format de charge utile est celui d'`AppDataExportService.buildExport()`
 * côté client — réutilisé tel quel comme prévu au §11 du plan, plutôt qu'un
 * format de transport supplémentaire à maintenir en double.
 */

/** Taille maximale acceptée pour l'ensemble de la configuration (garde-fou anti-abus). */
const MAX_PAYLOAD_BYTES = 512 * 1024;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();

  const db = createDb(context.env.DATABASE_URL);
  const rows = await db.select().from(userSettings).where(eq(userSettings.userId, auth.user.id));

  const data: Record<string, unknown> = {};
  const updatedAtByKey: Record<string, string> = {};
  let updatedAt: string | null = null;
  for (const row of rows) {
    data[row.key] = row.value;
    const iso = row.updatedAt.toISOString();
    updatedAtByKey[row.key] = iso;
    if (!updatedAt || iso > updatedAt) updatedAt = iso;
  }

  // `hasData` explicite plutôt que laissé à déduire côté client : c'est lui qui
  // décide quel écran de migration afficher (prompt 5.2 point 5).
  return json({
    hasData: rows.length > 0,
    keys: Object.keys(data),
    data,
    updatedAt,
    updatedAtByKey,
  });
};

/**
 * PATCH /api/v1/settings — écriture par clé, « dernier écrivain gagne ».
 *
 * Corps : `{ entries: [{ key, value, updatedAt }] }`. Un lot d'une seule
 * entrée EST l'écriture par clé : pas de route `/settings/{key}` séparée (voir
 * server/README.md, lot 6).
 *
 * Réponse : les clés appliquées, et pour chaque clé refusée la version du
 * compte (valeur + horodatage) — le client s'aligne dessus immédiatement,
 * sans second aller-retour.
 */
export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();
  if (!(await requireCsrf(context.request, auth))) return jsonError('jeton CSRF invalide', 403);

  const raw = await context.request.text();
  if (raw.length > MAX_PAYLOAD_BYTES) return jsonError('configuration trop volumineuse', 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError('corps JSON invalide', 400);
  }

  const now = new Date();
  const parsed = parsePatchBody(body, now);
  if (!parsed.ok) return jsonError(parsed.error, 400);
  if (parsed.value.length === 0) return json({ applied: [], rejected: [] });

  const db = createDb(context.env.DATABASE_URL);
  const keys = parsed.value.map((write) => write.key);
  const existing = await db
    .select()
    .from(userSettings)
    .where(and(eq(userSettings.userId, auth.user.id), inArray(userSettings.key, keys)));

  const remoteUpdatedAt = new Map(existing.map((row) => [row.key, row.updatedAt]));
  const { accepted, rejected } = resolveWrites(parsed.value, remoteUpdatedAt);

  if (accepted.length > 0) {
    await db
      .insert(userSettings)
      .values(
        accepted.map((write) => ({
          userId: auth.user.id,
          key: write.key,
          value: write.value,
          updatedAt: write.updatedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [userSettings.userId, userSettings.key],
        set: { value: sql`excluded.value`, updatedAt: sql`excluded.updated_at` },
        // Second garde-fou, en SQL cette fois : `resolveWrites` a décidé à
        // partir d'un SELECT qui date de quelques millisecondes, un autre
        // appareil peut avoir écrit entre-temps. Sans cette condition, une
        // écriture plus ancienne pourrait alors écraser une plus récente —
        // exactement ce que l'arbitrage cherche à empêcher.
        setWhere: sql`${userSettings.updatedAt} < excluded.updated_at`,
      });
  }

  const rejectedValues = new Map(existing.map((row) => [row.key, row.value]));
  return json({
    applied: accepted.map((write) => ({
      key: write.key,
      updatedAt: write.updatedAt.toISOString(),
    })),
    rejected: rejected.map((entry) => ({ ...entry, value: rejectedValues.get(entry.key) ?? null })),
  });
};

/**
 * PUT /api/v1/settings — remplace la configuration du compte par celle du
 * corps (`{ data: { profile: ..., watchlist: ... } }`).
 *
 * Remplacement complet et non fusion : le prompt 5.2 interdit explicitement de
 * fusionner deux jeux de données en silence. Le client a donc déjà tranché
 * (garder le local / garder le compte) au moment où cet appel part.
 */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();
  if (!(await requireCsrf(context.request, auth))) return jsonError('jeton CSRF invalide', 403);

  const raw = await context.request.text();
  if (raw.length > MAX_PAYLOAD_BYTES) return jsonError('configuration trop volumineuse', 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError('corps JSON invalide', 400);
  }

  const data = (body as { data?: unknown } | null)?.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return jsonError('champ "data" manquant ou invalide', 400);
  }

  const entries = Object.entries(data as Record<string, unknown>).filter(
    ([, value]) => value !== undefined,
  );
  // Liste blanche fermée (server/settings/keys.ts) : refuser franchement une
  // clé inconnue plutôt que de laisser `user_settings` accumuler n'importe
  // quel nom envoyé par un client modifié.
  const unknownKey = entries.find(([key]) => !isSyncedSettingKey(key));
  if (unknownKey) return jsonError(`clé inconnue : ${unknownKey[0]}`, 400);

  const db = createDb(context.env.DATABASE_URL);
  const now = new Date();

  // Pas de transaction possible avec le driver `neon-http` (voir
  // server/db/client.ts) : on écrit d'abord les nouvelles valeurs, puis on
  // supprime les clés absentes du corps. Dans cet ordre, une interruption
  // laisse au pire une clé obsolète de plus — jamais une configuration vidée.
  if (entries.length > 0) {
    await db
      .insert(userSettings)
      .values(entries.map(([key, value]) => ({ userId: auth.user.id, key, value, updatedAt: now })))
      .onConflictDoUpdate({
        target: [userSettings.userId, userSettings.key],
        set: { value: sql`excluded.value`, updatedAt: sql`excluded.updated_at` },
      });
  }

  const keptKeys = entries.map(([key]) => key);
  await db
    .delete(userSettings)
    .where(
      keptKeys.length > 0
        ? and(eq(userSettings.userId, auth.user.id), notInArray(userSettings.key, keptKeys))
        : eq(userSettings.userId, auth.user.id),
    );

  return json({ saved: keptKeys.length, updatedAt: now.toISOString() });
};
