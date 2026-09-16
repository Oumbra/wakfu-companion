#!/usr/bin/env -S npx tsx
/**
 * Rejeu de support : réinjecte pour UN compte les charges utiles d'historique que son client
 * aurait envoyées (`POST /api/v1/history/{fights,purchases,trades,pacts}`), après avoir
 * optionnellement supprimé les combats à remplacer. Cas d'usage : un utilisateur fournit son
 * `wakfu.log` après un bug de parsing corrigé depuis (ex. 2026-09-16, session HDV jamais refermée
 * — 17 combats archivés sans butin, combat interrompu jamais clôturé), et l'on veut que son
 * historique de compte reflète l'interprétation CORRIGÉE du fichier sans attendre qu'il relise
 * lui-même le fichier avec la nouvelle version — ce qui ne suffirait de toute façon pas : `fights`
 * est immuable après insertion (`ON CONFLICT DO NOTHING`, voir `ingestFights`), un combat déjà
 * connu avec un `kamas_gained` faux ne serait jamais corrigé par un simple rejeu.
 *
 * ## Où viennent les charges utiles
 *
 * Du client lui-même, pas d'un parseur réécrit ici : l'app web est pilotée en navigateur (Chrome
 * via `playwright-core`, voir CLAUDE.md), `HistorySyncService` activé avec l'`uid` RÉEL du compte
 * (les `clientKey` sont `sha256(uid|kind|signature)`, voir `client-key.util.ts` — donc identiques
 * à ce que le client de l'utilisateur produirait, et idempotents avec ses futurs envois), le
 * fichier poussé sur `LogFileAccessService.newLines$`, et `ApiClientService.requestJson` remplacé
 * par une capture des corps de requête. Le fichier `--events` attendu est cette capture :
 *
 * ```json
 * { "fights": [{ "entries": [...] }, ...], "purchases": [...], "trades": [...], "pacts": [...] }
 * ```
 *
 * (une entrée par POST capturé, corps EXACT — `clientKey`/`dungeonRunKey` déjà hachés). Chaque
 * corps repasse par `parseXxxBody` (mêmes validations que le handler) puis `ingestXxx`
 * (`server/history/ingest.ts`, MÊME code que le live : regroupement de donjon, `fight_type`...).
 *
 * ## Suppression préalable (`--delete-fight-log-ids`)
 *
 * Fichier texte, un `fightId` de log Wakfu par ligne (dernier champ de la ligne : `grep -oE
 * 'fightId=[0-9]+' wakfu.log | sort -u` convient tel quel) : supprime, AVANT le rejeu, les combats
 * du compte dont `fight_log_id` est dans cette liste (participants et butin suivent en cascade).
 * `fight_log_id` n'est pas garanti unique au-delà d'une session de jeu (voir sa doc dans
 * `server/db/schema.ts`) : `--since=<ISO>` borne la suppression aux combats démarrés à partir de
 * cet instant (typiquement la première ligne du fichier) — obligatoire dès que la liste est fournie.
 *
 * `--game-server=<code>` remplit `gameServer: null` dans chaque entrée rejouée : en navigateur de
 * support, `GameServerService` ne connaît pas le roster de l'utilisateur, le client capturé n'a
 * donc aucun serveur à envoyer — alors que ses propres envois en avaient un.
 *
 * ## Sécurité
 *
 * Dry-run par défaut : affiche les combats qui seraient supprimés, puis, pour chaque combat rejoué
 * déjà connu en base (même `fight_log_id`), un diff colonne par colonne (résultat, kamas, xp,
 * participants, butin, donjon) — à lire AVANT `--apply`, c'est la seule vérification que le rejeu
 * change bien ce qu'on attend et rien d'autre. Idempotent après application (rejouer sans
 * suppression = `ON CONFLICT`, aucune écriture).
 *
 * Usage :
 *   node tools/with-vars.mjs node node_modules/tsx/dist/cli.mjs server/import/replay-user-history.ts \
 *     --user=<uuid> --events=<capture.json> [--delete-fight-log-ids=<ids.txt> --since=<ISO>] \
 *     [--game-server=<code>] [--apply]
 *
 * (`node node_modules/tsx/dist/cli.mjs` plutôt que `npx tsx` sous Windows — voir la doc de
 * `backfill-dungeon-runs.ts`.)
 */
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { createDb, type Db } from '../db/client';
import { fightLoot, fightParticipants, fights } from '../db/schema';
import {
  ingestFights,
  ingestPactExtractions,
  ingestPurchases,
  ingestTrades,
  type IngestResult,
} from '../history/ingest';
import {
  parseFightsBody,
  parsePactExtractionsBody,
  parsePurchasesBody,
  parseTradesBody,
  type FightInput,
  type ParseResult,
} from '../history/parse';

interface Capture {
  fights?: unknown[];
  purchases?: unknown[];
  trades?: unknown[];
  pacts?: unknown[];
}

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function fail(message: string): never {
  console.error(`[replay-user-history] ${message}`);
  process.exit(1);
}

/** Remplit `gameServer: null` dans chaque entrée d'un corps capturé (voir doc de tête). */
function fillGameServer(body: unknown, code: string): unknown {
  if (!body || typeof body !== 'object') return body;
  const entries = (body as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return body;
  return {
    ...body,
    entries: entries.map((entry) =>
      entry && typeof entry === 'object' && (entry as { gameServer?: unknown }).gameServer == null
        ? { ...entry, gameServer: code }
        : entry,
    ),
  };
}

function parseAll<T>(
  label: string,
  bodies: unknown[],
  parse: (body: unknown) => ParseResult<T[]>,
): T[][] {
  return bodies.map((body, index) => {
    const parsed = parse(body);
    if (!parsed.ok) fail(`${label}[${index}] invalide : ${parsed.error}`);
    return parsed.value;
  });
}

interface StoredFight {
  id: number;
  fightLogId: number | null;
  startedAt: Date;
  won: boolean | null;
  kamasGained: number | null;
  xpGained: number | null;
  totalDamage: number | null;
  dungeonId: number | null;
  participants: number;
  loot: number;
}

async function loadStoredFights(
  db: Db,
  userId: string,
  fightLogIds: readonly number[],
  since: Date | null,
): Promise<StoredFight[]> {
  if (fightLogIds.length === 0) return [];
  const rows = await db
    .select({
      id: fights.id,
      fightLogId: fights.fightLogId,
      startedAt: fights.startedAt,
      won: fights.won,
      kamasGained: fights.kamasGained,
      xpGained: fights.xpGained,
      totalDamage: fights.totalDamage,
      dungeonId: fights.dungeonId,
    })
    .from(fights)
    .where(
      and(
        eq(fights.userId, userId),
        inArray(fights.fightLogId, fightLogIds),
        ...(since ? [gte(fights.startedAt, since)] : []),
      ),
    )
    .orderBy(asc(fights.startedAt));
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const participants = await db
    .select({ fightId: fightParticipants.fightId, n: sql<number>`count(*)` })
    .from(fightParticipants)
    .where(inArray(fightParticipants.fightId, ids))
    .groupBy(fightParticipants.fightId);
  const loot = await db
    .select({ fightId: fightLoot.fightId, n: sql<number>`count(*)` })
    .from(fightLoot)
    .where(inArray(fightLoot.fightId, ids))
    .groupBy(fightLoot.fightId);
  const participantsByFight = new Map(participants.map((row) => [row.fightId, Number(row.n)]));
  const lootByFight = new Map(loot.map((row) => [row.fightId, Number(row.n)]));
  return rows.map((row) => ({
    ...row,
    participants: participantsByFight.get(row.id) ?? 0,
    loot: lootByFight.get(row.id) ?? 0,
  }));
}

function describeStored(row: StoredFight): string {
  return `#${row.id} log=${row.fightLogId} ${row.startedAt.toISOString()} won=${row.won} kamas=${row.kamasGained} xp=${row.xpGained} dmg=${row.totalDamage} dj=${row.dungeonId} participants=${row.participants} loot=${row.loot}`;
}

/** Diff colonne par colonne entre un combat capturé et sa copie en base (même `fight_log_id`). */
function diffFight(input: FightInput, stored: StoredFight): string[] {
  const diffs: string[] = [];
  const check = (label: string, expected: unknown, actual: unknown): void => {
    if (expected !== actual)
      diffs.push(`${label}: base=${String(actual)} → rejeu=${String(expected)}`);
  };
  check('startedAt', input.startedAt.toISOString(), stored.startedAt.toISOString());
  check('won', input.won, stored.won);
  check('kamas', input.kamasGained, stored.kamasGained);
  check('xp', input.xpGained, stored.xpGained);
  check('totalDamage', input.totalDamage, stored.totalDamage);
  check('dungeonId', input.dungeonId, stored.dungeonId);
  check('participants', input.participants.length, stored.participants);
  check('loot', input.loot.length, stored.loot);
  return diffs;
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) fail('DATABASE_URL manquant dans l’environnement');
  const userId = readArg('user') ?? fail('--user=<uuid> requis');
  const eventsPath = readArg('events') ?? fail('--events=<capture.json> requis');
  const deleteListPath = readArg('delete-fight-log-ids');
  const sinceArg = readArg('since');
  const gameServer = readArg('game-server');
  const apply = process.argv.includes('--apply');

  const since = sinceArg ? new Date(sinceArg) : null;
  if (since && Number.isNaN(since.getTime())) fail(`--since invalide : ${sinceArg}`);
  if (deleteListPath && !since) fail('--since=<ISO> est obligatoire avec --delete-fight-log-ids');

  const capture = JSON.parse(readFileSync(eventsPath, 'utf8')) as Capture;
  const withServer = (bodies: unknown[] | undefined): unknown[] =>
    (bodies ?? []).map((body) => (gameServer ? fillGameServer(body, gameServer) : body));
  const fightBatches = parseAll('fights', withServer(capture.fights), parseFightsBody);
  const purchaseBatches = parseAll('purchases', withServer(capture.purchases), parsePurchasesBody);
  const tradeBatches = parseAll('trades', withServer(capture.trades), parseTradesBody);
  const pactBatches = parseAll('pacts', withServer(capture.pacts), parsePactExtractionsBody);
  const allFights = fightBatches.flat();
  console.log(
    `[replay-user-history] ${apply ? 'APPLICATION' : 'DRY-RUN'} — compte ${userId} : ${allFights.length} combat(s), ${purchaseBatches.flat().length} achat(s), ${tradeBatches.flat().length} échange(s), ${pactBatches.flat().length} extraction(s) de pacte à rejouer`,
  );

  const db = createDb(databaseUrl);

  // 1. Suppression préalable.
  let toDelete: StoredFight[] = [];
  if (deleteListPath) {
    const ids = readFileSync(deleteListPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/).at(-1) ?? '')
      .filter((value) => /^\d+$/.test(value))
      .map(Number);
    toDelete = await loadStoredFights(db, userId, ids, since);
    console.log(
      `\n[1] Suppression : ${ids.length} fightId de log fournis → ${toDelete.length} combat(s) en base depuis ${since!.toISOString()}`,
    );
    for (const row of toDelete) console.log('   ' + describeStored(row));
  }

  // 2. Diff des combats rejoués contre la base (état AVANT suppression : c'est ce qui sera remplacé).
  const replayedLogIds = allFights
    .map((fight) => fight.fightId)
    .filter((id): id is number => id !== null);
  const stored = await loadStoredFights(db, userId, replayedLogIds, since);
  const storedByLogId = new Map<number, StoredFight[]>();
  for (const row of stored) {
    if (row.fightLogId === null) continue;
    const list = storedByLogId.get(row.fightLogId) ?? [];
    list.push(row);
    storedByLogId.set(row.fightLogId, list);
  }
  console.log(
    `\n[2] Combats rejoués : ${allFights.length} (dont ${stored.length} déjà connus en base)`,
  );
  let unchanged = 0;
  for (const fight of allFights) {
    const copies = fight.fightId !== null ? (storedByLogId.get(fight.fightId) ?? []) : [];
    const label = `log=${fight.fightId} ${fight.startedAt.toISOString()} won=${fight.won} kamas=${fight.kamasGained} loot=${fight.loot.length}`;
    if (copies.length === 0) {
      console.log(`   NOUVEAU   ${label}`);
      continue;
    }
    for (const copy of copies) {
      const diffs = diffFight(fight, copy);
      if (diffs.length === 0) unchanged++;
      else console.log(`   DIFF #${copy.id} ${label}\n      ${diffs.join('\n      ')}`);
    }
  }
  console.log(`   ${unchanged} combat(s) strictement identiques à leur copie en base`);
  const notReplayed = toDelete.filter(
    (row) => row.fightLogId === null || !replayedLogIds.includes(row.fightLogId),
  );
  if (notReplayed.length > 0) {
    console.log(
      `\n⚠️  ${notReplayed.length} combat(s) seraient supprimés SANS être rejoués (absents de la capture) :`,
    );
    for (const row of notReplayed) console.log('   ' + describeStored(row));
  }

  if (!apply) {
    console.log('\nDry-run : rien n’a été écrit. Relancer avec --apply pour appliquer.');
    return;
  }

  if (toDelete.length > 0) {
    await db.delete(fights).where(
      and(
        eq(fights.userId, userId),
        inArray(
          fights.id,
          toDelete.map((row) => row.id),
        ),
      ),
    );
    console.log(`\n[1] ${toDelete.length} combat(s) supprimés (participants et butin en cascade)`);
  }

  const report = (label: string, results: IngestResult[]): void => {
    const inserted = results.reduce((sum, result) => sum + result.inserted, 0);
    const accepted = results.reduce((sum, result) => sum + result.accepted.length, 0);
    console.log(`[3] ${label} : ${accepted} accepté(s), ${inserted} inséré(s)`);
  };
  const fightResults: IngestResult[] = [];
  for (const batch of fightBatches)
    if (batch.length > 0) fightResults.push(await ingestFights(db, userId, batch));
  report('combats', fightResults);
  const purchaseResults: IngestResult[] = [];
  for (const batch of purchaseBatches)
    if (batch.length > 0) purchaseResults.push(await ingestPurchases(db, userId, batch));
  report('achats', purchaseResults);
  const tradeResults: IngestResult[] = [];
  for (const batch of tradeBatches)
    if (batch.length > 0) tradeResults.push(await ingestTrades(db, userId, batch));
  report('échanges', tradeResults);
  const pactResults: IngestResult[] = [];
  for (const batch of pactBatches)
    if (batch.length > 0) pactResults.push(await ingestPactExtractions(db, userId, batch));
  report('extractions de pacte', pactResults);
  console.log('\nTerminé.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
