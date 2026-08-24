#!/usr/bin/env -S npx tsx
/**
 * Rattrapage ponctuel : résout `fight_participants.monster_id` pour les lignes ennemies
 * (`side = 'enemy'`) restées `NULL` — cas normal en soi (voir le commentaire de
 * `fightParticipants.monsterId` dans server/db/schema.ts), mais qui peut se résorber après coup
 * quand `repository/monsters.json` gagne un monstre absent au moment de l'envoi initial.
 *
 * Ne PEUT PAS se contenter d'un `UPDATE ... WHERE name = X` naïf : `repository/monsters.json`
 * contient des homonymes (ex. "Corbac", "Malopo", ~25 cas constatés) que le nom seul ne permet
 * pas de distinguer. Ce script reproduit donc EXACTEMENT la logique de résolution du client
 * (`CatalogService.findWakfuMonsterEntry`/`applyIndex`, voir src/app/core/api/catalog.service.ts) :
 * une Map par nom FR puis une Map par nom EN/ES/PT, remplies en parcourant
 * `repository/monsters.json` dans l'ordre du fichier et où le PREMIER monstre à revendiquer un nom
 * donné l'emporte — c'est cet ordre de fichier qui a servi à peupler la table `monsters` à
 * l'import (voir server/import/import-catalog.ts, `rawMonsters.map(...)` puis insertion en lot
 * dans cet ordre, aucun ORDER BY côté serveur ensuite) : reconstruire la résolution à partir de ce
 * même fichier, plutôt que d'interroger la table `monsters` en base, garantit de retomber sur le
 * même choix que celui qu'aurait fait `HistorySyncService.monsterId` au moment de l'envoi.
 *
 * Dry-run par défaut (affiche ce qui serait mis à jour, rien n'est écrit) — `--apply` pour écrire
 * réellement. Idempotent : chaque UPDATE ne touche que les lignes encore `monster_id IS NULL`, un
 * rejeu ne modifie plus rien une fois appliqué.
 *
 * Usage : DATABASE_URL=... npx tsx server/import/backfill-monster-ids.ts [--apply]
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { normalizeWakfuName } from '../../src/app/core/utils/wakfu-name.util';

const projectRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const REFERENTIEL_DIR = path.join(projectRoot, 'repository');

interface RawMonster {
  id: number;
  fr: string;
  en: string;
  es: string;
  pt: string;
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL manquant.');
  const apply = process.argv.includes('--apply');

  const rawMonsters = JSON.parse(
    await readFile(path.join(REFERENTIEL_DIR, 'monsters.json'), 'utf-8'),
  ) as RawMonster[];

  // Miroir exact de CatalogService.applyIndex : "premier gagne" par nom, FR puis autres langues.
  const byFrName = new Map<string, number>();
  const byOtherLocaleName = new Map<string, number>();
  for (const monster of rawMonsters) {
    const frKey = normalizeWakfuName(monster.fr);
    if (!byFrName.has(frKey)) byFrName.set(frKey, monster.id);
    for (const localized of [monster.en, monster.es, monster.pt]) {
      const key = normalizeWakfuName(localized);
      if (!byOtherLocaleName.has(key)) byOtherLocaleName.set(key, monster.id);
    }
  }

  const sql = neon(databaseUrl, { fullResults: true });
  const selectResult = await sql`
    select distinct name from fight_participants
    where monster_id is null and side = 'enemy'
  `;
  const names = (selectResult.rows as { name: string }[]).map((r) => r.name);

  const resolved: { name: string; id: number }[] = [];
  const unresolved: string[] = [];
  for (const name of names) {
    const key = normalizeWakfuName(name);
    const id = byFrName.get(key) ?? byOtherLocaleName.get(key);
    if (id !== undefined) resolved.push({ name, id });
    else unresolved.push(name);
  }

  console.log(
    `[backfill-monster-ids] ${names.length} nom(s) ennemi(s) distinct(s) sans monster_id.`,
  );
  console.log(
    `[backfill-monster-ids] ${resolved.length} résolu(s) via repository/monsters.json, ${unresolved.length} inconnu(s) du référentiel (aucune mise à jour possible pour ceux-là).`,
  );
  for (const { name, id } of resolved) {
    console.log(`  ${apply ? 'UPDATE' : '[dry-run]'} "${name}" -> monster_id=${id}`);
  }
  if (unresolved.length > 0) {
    console.log('[backfill-monster-ids] noms non résolus :');
    for (const name of unresolved) console.log(`  - "${name}"`);
  }

  if (!apply) {
    console.log('[backfill-monster-ids] Dry-run — relancer avec --apply pour écrire réellement.');
    return;
  }

  let totalRows = 0;
  for (const { name, id } of resolved) {
    const result = await sql`
      update fight_participants
      set monster_id = ${id}
      where side = 'enemy' and monster_id is null and name = ${name}
    `;
    totalRows += result.rowCount ?? 0;
  }
  console.log(`[backfill-monster-ids] Terminé — ${totalRows} ligne(s) mise(s) à jour.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
