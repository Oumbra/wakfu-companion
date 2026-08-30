#!/usr/bin/env -S npx tsx
/**
 * Rattrapage ponctuel : calcule `fights.fight_type` (voir `FightTypeCode`, `server/db/schema.ts`)
 * pour les combats déjà archivés en base — nouvelle colonne, tous les combats existants au moment
 * de son ajout ont `fight_type IS NULL`, l'ingestion live (`functions/api/v1/history/fights.ts`,
 * voir `server/history/fight-type.ts`) ne s'appliquant qu'aux combats reçus À PARTIR de son
 * déploiement.
 *
 * ## Logique de calcul
 *
 * Entièrement portée par `server/history/fight-type.ts` (partagé avec l'ingestion live, voir sa
 * doc pour le détail des valeurs `FightTypeCode` et l'ordre de priorité) — ce script ne fait
 * qu'exécuter les deux `UPDATE ... FROM` qui y sont définis, sans aucune logique de classification
 * dupliquée ici. Contrairement à `backfill-dungeon-runs.ts` (qui rejoue un algorithme de
 * REGROUPEMENT multi-combats en mémoire, JS obligatoire), `fight_type` est une fonction PURE d'un
 * seul combat (son `dungeon_id` + ses `fight_participants` côté ennemi + le catalogue déjà en
 * base) : tout le calcul tient en SQL, aucune lecture préalable ni boucle applicative.
 *
 * ## Idempotence / rejouabilité
 *
 * Les deux `UPDATE` recalculent `fight_type` à chaque exécution (aucun `WHERE fight_type IS NULL`)
 * — rejouer ce script après application ne change donc rien pour un combat déjà à jour, mais le
 * met AUSSI à jour un combat dont le classement aurait changé depuis (donjon nouvellement identifié
 * a posteriori par `backfill-dungeon-runs.ts`, correction du référentiel `dungeons`/`monsters`,
 * etc.) — sûr et bon marché à relancer à tout moment, contrairement à un script à sens unique.
 *
 * ## Environnements (dev/prod)
 *
 * Comme tous les scripts `server/import/*` : `DATABASE_URL` vient de l'environnement, jamais d'un
 * argument — voir `npm run main:backfill:fight-type` (prod, via `tools/with-vars.mjs` + `.vars`) et
 * `npm run dev:backfill:fight-type` (dev/preview, via `tools/with-dev-vars.mjs` + `.dev.vars`).
 *
 * ## Sécurité
 *
 * Dry-run par défaut (rien n'est écrit, seul un aperçu de la distribution AVANT/APRÈS et du nombre
 * de combats qui changeraient de valeur est affiché) — `--apply` pour écrire réellement. `--user=
 * <uuid>` restreint le script à un seul compte (recommandé pour une première vérification
 * supervisée avant un passage sur toute la base, même convention que `backfill-dungeon-runs.ts`).
 * `--verbose` détaille chaque combat qui changerait de valeur (par défaut, un échantillon de 20).
 *
 * Usage :
 *   DATABASE_URL=... npx tsx server/import/backfill-fight-type.ts [--apply] [--user=<uuid>] [--verbose]
 *   npm run dev:backfill:fight-type -- [--apply] [--user=<uuid>] [--verbose]
 *   npm run main:backfill:fight-type -- [--apply] [--user=<uuid>] [--verbose]
 *
 * ⚠️ Sous Windows, préférer `node node_modules/tsx/dist/cli.mjs <script>` à `npx tsx <script>` quand
 * la commande passe par `tools/with-vars.mjs`/`tools/with-dev-vars.mjs` (`spawnSync(..., { shell:
 * true })`) — voir la doc équivalente dans `backfill-dungeon-runs.ts` pour le détail du contournement
 * (déjà appliqué aux scripts npm `backfill:fight-type`/`main:backfill:fight-type`/
 * `dev:backfill:fight-type` ci-dessous, comme pour `backfill:dungeon-runs`).
 */
import { sql, type SQL } from 'drizzle-orm';
import { createDb } from '../db/client';
import type { FightTypeCode } from '../db/schema';
import {
  dungeonFightTypeSelectSql,
  dungeonFightTypeUpdateSql,
  familyFightTypeSelectSql,
  familyFightTypeUpdateSql,
  fightTypeDistributionSql,
} from '../history/fight-type';

interface PreviewRow {
  id: number;
  current: FightTypeCode | null;
  computed: FightTypeCode;
}

async function fetchPreview(
  db: ReturnType<typeof createDb>,
  scope: SQL,
): Promise<{ dungeonRows: PreviewRow[]; familyRows: PreviewRow[] }> {
  const [dungeonResult, familyResult] = await Promise.all([
    db.execute(dungeonFightTypeSelectSql(scope)),
    db.execute(familyFightTypeSelectSql(scope)),
  ]);
  return {
    dungeonRows: dungeonResult.rows as unknown as PreviewRow[],
    familyRows: familyResult.rows as unknown as PreviewRow[],
  };
}

function printDistribution(
  label: string,
  rows: { fight_type: string | null; count: unknown }[],
): void {
  console.log(`[backfill-fight-type] ${label} :`);
  if (rows.length === 0) {
    console.log('  (table vide ou aucun combat dans ce périmètre)');
    return;
  }
  for (const row of rows) {
    console.log(`  ${row.fight_type ?? '(null)'} : ${row.count}`);
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL manquant.');
  const apply = process.argv.includes('--apply');
  const verbose = process.argv.includes('--verbose');
  const userArg = process.argv.find((arg) => arg.startsWith('--user='));
  const onlyUserId = userArg ? userArg.slice('--user='.length) : null;

  const db = createDb(databaseUrl);
  const scope = onlyUserId ? sql`f.user_id = ${onlyUserId}` : sql`true`;

  console.log(
    onlyUserId
      ? `[backfill-fight-type] Périmètre : compte ${onlyUserId}.`
      : '[backfill-fight-type] Périmètre : tous les comptes.',
  );

  const before = await db.execute(fightTypeDistributionSql(scope));
  printDistribution(
    'Distribution AVANT',
    before.rows as { fight_type: string | null; count: unknown }[],
  );

  const { dungeonRows, familyRows } = await fetchPreview(db, scope);
  const changedRows = [...dungeonRows, ...familyRows].filter((row) => row.current !== row.computed);

  console.log(
    `[backfill-fight-type] ${dungeonRows.length} combat(s) dans un donjon, ${familyRows.length} combat(s) classifiables hors donjon (famille résolue) — ${changedRows.length} changerai(en)t de valeur.`,
  );

  const sample = verbose ? changedRows : changedRows.slice(0, 20);
  for (const row of sample) {
    console.log(
      `  ${apply ? 'UPDATE' : '[dry-run]'} fight #${row.id} -> fight_type: ${row.current ?? '(null)'} → ${row.computed}`,
    );
  }
  if (!verbose && changedRows.length > sample.length) {
    console.log(
      `  ... et ${changedRows.length - sample.length} de plus (--verbose pour tout voir).`,
    );
  }

  if (apply) {
    await db.execute(dungeonFightTypeUpdateSql(scope));
    await db.execute(familyFightTypeUpdateSql(scope));
    const after = await db.execute(fightTypeDistributionSql(scope));
    printDistribution(
      'Distribution APRÈS',
      after.rows as { fight_type: string | null; count: unknown }[],
    );
    console.log('[backfill-fight-type] Terminé — colonne mise à jour.');
  } else {
    console.log('[backfill-fight-type] Dry-run — relancer avec --apply pour écrire réellement.');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
