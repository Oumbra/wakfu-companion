#!/usr/bin/env -S npx tsx
/**
 * Retrait du pseudonyme d'un joueur tiers de toutes les données de compte — la contrepartie
 * technique de ce que promet la politique de confidentialité (§1.3) : « Tout joueur peut demander
 * le retrait de son pseudonyme en nous écrivant à contact@wakfu-companion.com ».
 *
 * RGPD art. 21 (opposition à un traitement fondé sur l'intérêt légitime) et art. 17.1.c
 * (effacement qui en découle), à servir dans le délai d'un mois de l'art. 12.3. Jusqu'ici la
 * promesse n'avait aucun moyen d'exécution : il aurait fallu écrire du SQL à la main sur une base
 * de production, sur quatre emplacements dont un `jsonb` opaque — voir `docs/analyse-rgpd.md` 4.12.
 *
 * ## Où un pseudonyme de tiers peut se trouver
 *
 * | Emplacement                 | Traitement                                                      |
 * | --------------------------- | --------------------------------------------------------------- |
 * | `fight_participants.name`   | Renommé (jamais supprimé : la ligne porte les dégâts du combat) |
 * | `trades.peer_name`          | Renommé (l'échange reste dans l'historique de son titulaire)    |
 * | `user_settings.value`       | Filtre de chat / correction d'attribution retiré(e)             |
 * | `erased_third_party_names`  | Ajouté : l'ingestion remplace ce nom dans tout envoi futur      |
 * | `trades.self_name`          | Signalé seulement — c'est un personnage du TITULAIRE            |
 * | `users.display_name`        | Signalé seulement — c'est le compte lui-même, pas un tiers      |
 *
 * Renommer plutôt que supprimer : la ligne de participant porte les dégâts, soins et sorts du
 * combat, qui appartiennent à l'historique du titulaire du compte (son droit à un historique
 * fidèle, mis en balance au §1.3). La supprimer fausserait ses totaux ; la renommer en
 * `PLACEHOLDER` rend le tiers non identifiable — ce que demande le droit d'opposition — sans rien
 * détruire du traitement licite d'autrui.
 *
 * ## Usage
 *
 *     npm run main:erase:third-party-name -- --name "Pseudo"           # inventaire seul (dry-run)
 *     npm run main:erase:third-party-name -- --name "Pseudo" --apply   # écrit réellement
 *
 * Dry-run par défaut. Idempotent : une seconde exécution ne trouve plus rien. La comparaison est
 * insensible à la casse (`lower(name) = lower($1)`), jamais une comparaison « contient » — retirer
 * « Bobby » pour une demande de « Bob » serait une atteinte aux données d'un autre tiers.
 *
 * ⚠ Consigner la demande et son exécution dans le registre des traitements (dossier RGPD du
 * responsable, hors dépôt) : date de réception, pseudonyme visé, compteurs affichés ci-dessous,
 * date de réponse au demandeur.
 */
import { neon } from '@neondatabase/serverless';
import { redactName } from '../settings/redact-name';
import { ERASED_NAME_PLACEHOLDER } from '../history/erased-names';

/** Remplace le pseudonyme dans l'historique. Générique exprès : ne désigne plus personne. */
const PLACEHOLDER = ERASED_NAME_PLACEHOLDER;

interface Args {
  name: string;
  apply: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const nameIndex = argv.indexOf('--name');
  const name = nameIndex === -1 ? '' : (argv[nameIndex + 1] ?? '').trim();
  if (!name) {
    throw new Error(
      'Usage : npm run main:erase:third-party-name -- --name "Pseudo" [--apply]\n' +
        '(--name est obligatoire ; sans --apply, rien n’est écrit.)',
    );
  }
  return { name, apply: argv.includes('--apply') };
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL manquant.');
  const { name, apply } = parseArgs(process.argv.slice(2));

  const sql = neon(databaseUrl, { fullResults: true });
  console.log(
    `\nPseudonyme visé : « ${name} »${apply ? '' : '   [dry-run — rien ne sera écrit]'}\n`,
  );

  // ── 1. Participants de combat ──────────────────────────────────────────────────────────────
  const participants = (
    await sql`
      select f.user_id, p.side, count(*)::int as n
      from fight_participants p
      join fights f on f.id = p.fight_id
      where lower(p.name) = lower(${name})
      group by f.user_id, p.side
    `
  ).rows as { user_id: string; side: string; n: number }[];
  const participantTotal = participants.reduce((sum, row) => sum + row.n, 0);
  console.log(`[1] fight_participants : ${participantTotal} ligne(s)`);
  for (const row of participants) {
    console.log(`    compte ${row.user_id} · ${row.side} · ${row.n}`);
  }

  // ── 2. Échanges ────────────────────────────────────────────────────────────────────────────
  const peers = (
    await sql`
      select user_id, count(*)::int as n from trades
      where lower(peer_name) = lower(${name}) group by user_id
    `
  ).rows as { user_id: string; n: number }[];
  const peerTotal = peers.reduce((sum, row) => sum + row.n, 0);
  console.log(`[2] trades.peer_name : ${peerTotal} ligne(s)`);
  for (const row of peers) console.log(`    compte ${row.user_id} · ${row.n}`);

  // ── 3. Configurations synchronisées ────────────────────────────────────────────────────────
  // Le `jsonb` est opaque côté base : on le charge et on le nettoie en mémoire (voir
  // server/settings/redact-name.ts, testé). Pré-filtré sur le texte du document pour ne pas
  // rapatrier toute la table — le filtre est volontairement large (`ilike`), la décision fine
  // revenant à `redactName`, qui ne retire que les égalités exactes.
  const settings = (
    await sql`
      select user_id, key, value from user_settings
      where value::text ilike ${'%' + name + '%'}
    `
  ).rows as { user_id: string; key: string; value: unknown }[];
  const pending: { userId: string; key: string; value: unknown; removed: number }[] = [];
  let residualTotal = 0;
  for (const row of settings) {
    const result = redactName(row.value, name);
    if (result.removed > 0) {
      pending.push({
        userId: row.user_id,
        key: row.key,
        value: result.value,
        removed: result.removed,
      });
    }
    if (result.residual > 0) {
      residualTotal += result.residual;
      console.log(
        `    ⚠ compte ${row.user_id} · ${row.key} · ${result.residual} occurrence(s) NON retirable(s) automatiquement`,
      );
    }
  }
  const settingTotal = pending.reduce((sum, row) => sum + row.removed, 0);
  console.log(
    `[3] user_settings : ${settingTotal} entrée(s) à retirer dans ${pending.length} clé(s)`,
  );
  for (const row of pending) console.log(`    compte ${row.userId} · ${row.key} · ${row.removed}`);

  // ── 4. Emplacements qui ne relèvent PAS du droit d'opposition d'un tiers ───────────────────
  const selfNames = (
    await sql`
      select user_id, count(*)::int as n from trades
      where lower(self_name) = lower(${name}) group by user_id
    `
  ).rows as { user_id: string; n: number }[];
  const displayNames = (await sql`select id from users where lower(display_name) = lower(${name})`)
    .rows as { id: string }[];
  if (selfNames.length || displayNames.length) {
    console.log(
      `[4] À vérifier à la main — ce pseudonyme désigne aussi le TITULAIRE d'un compte, dont les\n` +
        `    données relèvent de sa propre demande (art. 15 à 17), pas de celle d'un tiers :`,
    );
    for (const row of selfNames) {
      console.log(`    compte ${row.user_id} · trades.self_name · ${row.n}`);
    }
    for (const row of displayNames) console.log(`    compte ${row.id} · users.display_name`);
  }

  const nothingStored = participantTotal + peerTotal + settingTotal === 0;
  if (nothingStored) {
    console.log('\nRien à retirer : ce pseudonyme n’apparaît dans aucune donnée de compte.');
    if (residualTotal > 0)
      console.log('(Hors occurrences signalées ci-dessus, à traiter à la main.)');
  }

  if (!apply) {
    console.log(
      '\nDry-run : rien n’a été écrit. Relancer avec --apply pour appliquer' +
        (nothingStored
          ? ' (le pseudonyme sera tout de même ajouté à la liste des retraits).'
          : '.'),
    );
    return;
  }

  // ── Application ────────────────────────────────────────────────────────────────────────────
  // D'abord la liste d'opposition, consultée à chaque ingestion (server/history/erased-names.ts) :
  // sans elle, un combat ou un échange envoyé plus tard réécrirait le nom d'origine. Posée même
  // quand rien n'est encore stocké : l'opposition vaut aussi pour les envois à venir.
  await sql`
    insert into erased_third_party_names (name_lower) values (lower(${name}))
    on conflict (name_lower) do nothing
  `;
  console.log(`\n[0] « ${name} » ajouté à la liste des pseudonymes retirés`);
  if (nothingStored) return;

  // Renommage des participants : la clé primaire est (fight_id, name, instance_index) — sans le
  // camp depuis la migration 0035 —, donc un combat où le placeholder existerait DÉJÀ avec le même
  // indice (dans l'un OU l'autre camp) ferait échouer l'UPDATE global. Traité ligne par ligne, la
  // collision — théorique, mais destructrice si on la laissait au hasard — étant résolue en
  // poussant l'indice d'instance au-delà du maximum du combat.
  let renamedParticipants = 0;
  let shiftedParticipants = 0;
  const rows = (
    await sql`
      select fight_id, side, instance_index from fight_participants
      where lower(name) = lower(${name})
    `
  ).rows as { fight_id: number; side: string; instance_index: number }[];
  for (const row of rows) {
    const clash = (
      await sql`
        select 1 from fight_participants
        where fight_id = ${row.fight_id}
          and name = ${PLACEHOLDER} and instance_index = ${row.instance_index}
      `
    ).rows.length;
    let instanceIndex = row.instance_index;
    if (clash) {
      const max = (
        await sql`
          select coalesce(max(instance_index), 0)::int as m from fight_participants
          where fight_id = ${row.fight_id}
        `
      ).rows[0] as { m: number };
      instanceIndex = max.m + 1;
      shiftedParticipants += 1;
    }
    await sql`
      update fight_participants set name = ${PLACEHOLDER}, instance_index = ${instanceIndex}
      where fight_id = ${row.fight_id} and side = ${row.side}
        and instance_index = ${row.instance_index} and lower(name) = lower(${name})
    `;
    renamedParticipants += 1;
  }
  console.log(
    `\n[1] ${renamedParticipants} participant(s) renommé(s) en « ${PLACEHOLDER} »` +
      (shiftedParticipants ? ` (dont ${shiftedParticipants} avec indice d'instance décalé)` : ''),
  );

  const updatedTrades = (
    await sql`
      update trades set peer_name = ${PLACEHOLDER} where lower(peer_name) = lower(${name})
    `
  ).rowCount;
  console.log(`[2] ${updatedTrades} échange(s) anonymisé(s)`);

  for (const row of pending) {
    await sql`
      update user_settings set value = ${JSON.stringify(row.value)}::jsonb, updated_at = now()
      where user_id = ${row.userId}::uuid and key = ${row.key}
    `;
  }
  console.log(
    `[3] ${pending.length} clé(s) de configuration mise(s) à jour (${settingTotal} entrée(s) retirée(s))`,
  );
  console.log(
    '\nTerminé. `updated_at` a été avancé sur les clés touchées : les appareils encore connectés\n' +
      'récupéreront la version nettoyée à leur prochaine synchronisation (dernier écrivain gagne,\n' +
      'voir server/settings/merge.ts). Consigner la demande dans le registre des traitements.',
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
