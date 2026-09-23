import type { PagesFunction } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import { createDb } from '../../../../server/db/client';
import { sessions, userIdentities, userSettings, users } from '../../../../server/db/schema';
import { authenticate, json, rejectNativeCaller, unauthenticated } from '../../_auth';
import type { Env } from '../../_types';

/**
 * GET /api/v1/auth/export — copie des données de COMPTE détenues côté serveur
 * (droit d'accès et portabilité, RGPD art. 15 et 20 ; `docs/analyse-rgpd.md`
 * 4.2, plan #17).
 *
 * Renvoie tout ce que le serveur sait du compte et qui n'a AUCUN autre point
 * de sortie : la ligne `users` (dates comprises), les identités OAuth (avec
 * l'identifiant chez le fournisseur), TOUTES les sessions encore en base — y
 * compris révoquées, remplacées ou expirées, tant que leur trace n'a pas été
 * purgée (`purgeDeadSessions`, 30 jours) : `GET /auth/sessions` ne montre que
 * les vivantes, or la trace d'une session morte est encore une donnée détenue
 * — et la configuration synchronisée avec son horodatage par clé.
 *
 * L'historique (combats, achats, échanges, extractions de pacte) N'EST PAS
 * inclus ici, volontairement : il est déjà intégralement accessible par les
 * quatre `GET /api/v1/history/*` paginés (`limit` jusqu'à 200, curseur
 * `before`), que le client enchaîne jusqu'à épuisement pour composer le fichier
 * (`AccountExportService`). Le servir d'un bloc aurait signifié sérialiser des
 * milliers de combats (participants et ventilation par sort en `jsonb`) dans
 * une seule réponse — hors du budget CPU d'une Pages Function (voir
 * server/README.md) pour un historique de joueur assidu, alors que la
 * pagination existante est déjà bornée et testée. Le fichier final est le même.
 *
 * Aucune donnée d'un tiers autre que celles déjà visibles à l'utilisateur
 * (aucune adresse IP : le comptage anti-abus n'est jamais rattaché au compte).
 *
 * Session de navigateur exigée (audit du 2026-09-23) : un jeton d'overlay reçoit 403
 * `browser_session_required` (voir `rejectNativeCaller`, `_auth.ts`) — l'export est un geste de
 * l'utilisateur depuis « Mon compte », pas une capacité à laisser à un jeton posé sur un disque.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (!auth) return unauthenticated();
  const nativeRejection = rejectNativeCaller(auth);
  if (nativeRejection) return nativeRejection;

  const db = createDb(context.env.DATABASE_URL);
  const userId = auth.user.id;
  const [userRows, identityRows, sessionRows, settingRows] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    db.select().from(userIdentities).where(eq(userIdentities.userId, userId)),
    db.select().from(sessions).where(eq(sessions.userId, userId)),
    db.select().from(userSettings).where(eq(userSettings.userId, userId)),
  ]);
  const [user] = userRows;
  if (!user) return unauthenticated();

  const settings: Record<string, { value: unknown; updatedAt: string }> = {};
  for (const row of settingRows) {
    settings[row.key] = { value: row.value, updatedAt: row.updatedAt.toISOString() };
  }

  return json({
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
      lastSeenAt: user.lastSeenAt.toISOString(),
    },
    identities: identityRows.map((identity) => ({
      provider: identity.provider,
      providerUid: identity.providerUid,
      email: identity.email,
      linkedAt: identity.linkedAt.toISOString(),
    })),
    // Comme pour `GET /auth/sessions`, `id` est l'empreinte stockée, jamais un jeton.
    sessions: sessionRows
      .map((session) => ({
        id: session.id,
        current: session.id === auth.sessionIdHash,
        issuedAt: session.issuedAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        absoluteExpiresAt: session.absoluteExpiresAt?.toISOString() ?? null,
        userAgent: session.userAgent,
        revokedAt: session.revokedAt?.toISOString() ?? null,
        supersededAt: session.supersededAt?.toISOString() ?? null,
      }))
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt)),
    settings,
  });
};
