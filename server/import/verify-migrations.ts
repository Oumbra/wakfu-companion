#!/usr/bin/env -S npx tsx
/**
 * Garde-fou post-migration (déclenché juste après `npm run db:migrate` dans
 * deploy-preview.yml) : compare le nombre de fichiers `.sql` de
 * `server/db/migrations/` au nombre de lignes de `drizzle.__drizzle_migrations`
 * côté base — échoue (exit 1) en cas d'écart.
 *
 * Raison d'être : `drizzle-kit migrate` peut annoncer
 * "[✓] migrations applied successfully!" (exit 0, aucune erreur) SANS avoir
 * réellement appliqué une migration pourtant bien en attente — vécu en
 * conditions réelles le 2026-08-12 (migration `0010_peaceful_brood`, jamais
 * appliquée sur la base preview malgré un run CI "success", cause probable :
 * son horodatage interne (`when` dans `meta/_journal.json`) est antérieur à
 * celui de `0009_rename_dungeons_bracket`, committée après elle — un journal
 * pas strictement croissant en temps a suffi à dérouter l'algorithme sans
 * qu'aucune erreur ne remonte). Conséquence concrète ce jour-là : la colonne
 * manquante faisait planter `GET /api/v1/dungeons` (500), ce qui annulait
 * silencieusement toute mise à jour du cache catalogue côté client (objets
 * ET monstres compris, voir CatalogService.refreshIfNeeded) — un bug de
 * schéma DB invisible en CI s'est donc traduit, des heures plus tard, par un
 * référentiel objets qui semblait ne jamais se mettre à jour pour l'utilisateur
 * final, sans le moindre lien apparent avec la vraie cause.
 *
 * Utilise le driver HTTP `neon()` (comme server/db/client.ts) plutôt que
 * `drizzle-kit` lui-même : c'est justement le mécanisme interne de
 * `drizzle-kit migrate` (nécessite un websocket, voir son avertissement au
 * démarrage) qui est en cause ici, on ne veut pas revérifier avec le même outil
 * potentiellement en défaut.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'db',
  'migrations',
);

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL manquant.');

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql'));
  const sql = neon(databaseUrl);
  const rows = await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
  const appliedCount = (rows[0] as { count: number }).count;

  console.log(
    `[verify-migrations] ${files.length} fichier(s) de migration sur disque, ${appliedCount} enregistrement(s) appliqué(s) en base.`,
  );

  if (appliedCount !== files.length) {
    console.error(
      `[verify-migrations] ÉCART DÉTECTÉ : ${files.length} migration(s) sur disque mais ${appliedCount} appliquée(s) en base. ` +
        `"drizzle-kit migrate" a probablement annoncé un succès sans tout appliquer (voir le commentaire en tête de ce fichier). ` +
        `Vérifier server/db/migrations/meta/_journal.json (horodatages "when" strictement croissants ?) et rejouer/réparer manuellement si besoin.`,
    );
    process.exit(1);
  }

  console.log('[verify-migrations] OK — migrations sur disque et en base alignées.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
