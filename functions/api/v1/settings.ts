import type { PagesFunction } from '@cloudflare/workers-types';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { createDb } from '../../../server/db/client';
import { userSettings } from '../../../server/db/schema';
import { authenticate, json, jsonError, requireCsrf, unauthenticated } from '../_auth';
import type { Env } from '../_types';

/**
 * Configuration utilisateur — **version minimale du lot 5** (voir le
 * commentaire de `userSettings` dans server/db/schema.ts).
 *
 * Elle n'existe ici que pour rendre réel le parcours de migration des données
 * locales demandé par le prompt 5.2 (« propose de téléverser », « si le compte
 * a déjà des données, demande laquelle des deux sources garder »). Le lot 6
 * reprendra ce fichier pour la vraie synchronisation : écriture par clé,
 * horodatage par clé, résolution de conflits, file d'envoi côté client.
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
  let updatedAt: string | null = null;
  for (const row of rows) {
    data[row.key] = row.value;
    const iso = row.updatedAt.toISOString();
    if (!updatedAt || iso > updatedAt) updatedAt = iso;
  }

  // `hasData` explicite plutôt que laissé à déduire côté client : c'est lui qui
  // décide quel écran de migration afficher (prompt 5.2 point 5).
  return json({ hasData: rows.length > 0, keys: Object.keys(data), data, updatedAt });
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
