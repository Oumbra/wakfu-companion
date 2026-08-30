import { sql, type SQL } from 'drizzle-orm';

/**
 * Calcul de `fights.fightType` (voir `FightTypeCode`, `server/db/schema.ts`) — partagé entre
 * l'ingestion live (`functions/api/v1/history/fights.ts`, POST) et le script de rattrapage
 * `server/import/backfill-fight-type.ts`. Un seul endroit pour cette logique : les deux appelants
 * doivent rester bit-à-bit cohérents, une divergence produirait un combat classifié différemment
 * selon qu'il vient de l'ingestion live ou d'un rejeu du script.
 *
 * Pas de lecture préalable en JS (contrairement à `backfill-dungeon-runs.ts`, qui rejoue un
 * algorithme de REGROUPEMENT multi-combats en mémoire) : `fightType` est une fonction PURE d'un
 * seul combat (son `dungeon_id` + ses `fight_participants` côté ennemi + le catalogue déjà en
 * base), sans aucun état inter-combat à reconstruire — de simples requêtes SQL suffisent, jamais
 * besoin d'une boucle applicative ni d'un découpage par compte.
 *
 * Chaque valeur CASE (`dungeonFightTypeValueExpr`/`familyFightTypeValueExpr`) est factorisée à
 * part et réutilisée à la fois dans un `UPDATE ... SET` (écriture réelle) et dans un `SELECT`
 * (aperçu à blanc du script de rattrapage, voir sa doc) : la valeur proposée par l'aperçu est donc
 * GARANTIE identique à celle réellement écrite, aucune formule dupliquée à maintenir en double.
 *
 * `scope` (paramètre de tous les exports ci-dessous) est un fragment SQL additionnel en `AND` (ex.
 * `sql\`true\`` pour toute la table, `sql\`f.id in (${sql.join(ids.map((id) => sql\`${id}\`),
 * sql\`, \`)})\`` pour un lot d'ingestion précis, `sql\`f.user_id = ${userId}\`` pour un compte
 * donné) — voir les appelants.
 *
 * Les `UPDATE` sont idempotents et rejouables à volonté (aucun ne dépend de la valeur actuelle de
 * `fight_type`, entièrement recalculée à chaque exécution) — contrairement à
 * `backfill-dungeon-runs.ts`, jamais besoin d'un garde `WHERE fight_type IS NULL`.
 */

/**
 * Valeur `fight_type` pour un combat DANS un donjon (`dungeon_id` non NULL, jointure `dungeons d`
 * déjà en place côté appelant) : dépend du `type` du donjon et, pour les donjons à salles
 * (`TWO_ROOMS`/`THREE_ROOMS`/`FOUR_ROOMS`), de la présence ou non d'un ennemi `is_boss` DANS CE
 * COMBAT PRÉCIS (voir `FightTypeCode` pour le détail `DUNGEON_{type}` vs `DUNGEON_ROOM`).
 *
 * `ARCADE` (et tout type de donjon futur non couvert) laisse `fight_type` inchangé (`else
 * f.fight_type`, jamais une valeur inventée) — voir la doc de `FightTypeCode` sur pourquoi ce cas
 * ne devrait structurellement jamais se produire en pratique.
 */
function dungeonFightTypeValueExpr(): SQL {
  return sql`case
    when d.type = 'BREACH' then 'BREACH'
    when d.type = 'ULTIMATE_BREACH' then 'ULTIMATE_BREACH'
    when d.type = 'THREE_PLAYERS' then 'DUNGEON_THREE_PLAYERS'
    when d.type = 'ULTIMATE_BOSS' then 'DUNGEON_ULTIMATE_BOSS'
    when d.type in ('TWO_ROOMS', 'THREE_ROOMS', 'FOUR_ROOMS') then
      case
        when exists (
          select 1 from fight_participants fp
          join monsters m on m.id = fp.monster_id
          where fp.fight_id = f.id and fp.side = 'enemy' and m.is_boss = true
        ) then 'DUNGEON_' || d.type
        else 'DUNGEON_ROOM'
      end
    else f.fight_type
  end`;
}

/** Écrit `fight_type` pour tous les combats DANS un donjon (`dungeon_id` non NULL) matchant
 * `scope` — voir `dungeonFightTypeValueExpr`. */
export function dungeonFightTypeUpdateSql(scope: SQL): SQL {
  return sql`
    update fights as f
    set fight_type = ${dungeonFightTypeValueExpr()}
    from dungeons d
    where f.dungeon_id = d.id and (${scope})
  `;
}

/** Aperçu (lecture seule) de la valeur `fight_type` que `dungeonFightTypeUpdateSql` écrirait pour
 * chaque combat matchant `scope` — même expression, voir sa doc. `id`/`current` (valeur en base
 * avant écriture)/`computed` (valeur proposée) par ligne. */
export function dungeonFightTypeSelectSql(scope: SQL): SQL {
  return sql`
    select f.id as id, f.fight_type as current, ${dungeonFightTypeValueExpr()} as computed
    from fights f
    join dungeons d on f.dungeon_id = d.id
    where (${scope})
  `;
}

/**
 * Sous-requête "famille représentative" d'un combat HORS donjon — même priorité que
 * `resolveFightTypeClassification`/`familyPerFight` (`functions/api/v1/history/stats.ts`) : boss >
 * archimonstre > dominant > plus gros dégât. `DISTINCT ON` (Postgres) plutôt qu'un `ROW_NUMBER()
 * OVER`, même choix et même raison que `familyPerFight` (pas de support `selectDistinctOn` dans la
 * version de drizzle-orm utilisée ici). Un combat dont AUCUN ennemi n'a de `monster_id` résolu
 * (jamais catalogué) ne matche aucune ligne ici : `fight_type` reste `null` pour lui — même trou
 * déjà accepté par `familyPerFight` (voir `FightTypeCode`).
 */
function representativeFamilyPerFightSql(): SQL {
  return sql`(
    select distinct on (fp.fight_id) fp.fight_id as fight_id, m.family as family
    from fight_participants fp
    join monsters m on m.id = fp.monster_id
    where fp.side = 'enemy'
    order by fp.fight_id,
      case when m.is_boss then 0 when m.is_archi then 1 when m.is_dominant then 2 else 3 end,
      fp.damage desc
  )`;
}

function familyFightTypeValueExpr(): SQL {
  return sql`case when ff.family is null then 'FAMILY_NONE' else 'FAMILY_' || ff.family::text end`;
}

/** Écrit `fight_type` pour tous les combats HORS donjon (`dungeon_id` NULL) matchant `scope` —
 * voir `representativeFamilyPerFightSql`/`familyFightTypeValueExpr`. */
export function familyFightTypeUpdateSql(scope: SQL): SQL {
  return sql`
    update fights as f
    set fight_type = ${familyFightTypeValueExpr()}
    from ${representativeFamilyPerFightSql()} ff
    where f.id = ff.fight_id and f.dungeon_id is null and (${scope})
  `;
}

/** Aperçu (lecture seule) de la valeur `fight_type` que `familyFightTypeUpdateSql` écrirait pour
 * chaque combat matchant `scope` — même expression, voir sa doc. `id`/`current` (valeur en base
 * avant écriture)/`computed` (valeur proposée) par ligne. */
export function familyFightTypeSelectSql(scope: SQL): SQL {
  return sql`
    select f.id as id, f.fight_type as current, ${familyFightTypeValueExpr()} as computed
    from fights f
    join ${representativeFamilyPerFightSql()} ff on ff.fight_id = f.id
    where f.dungeon_id is null and (${scope})
  `;
}

/**
 * Combat HORS donjon dont AUCUN ennemi n'a pu être résolu dans le catalogue `monsters` (le "trou"
 * `null` documenté par `FightTypeCode`/`EVENT`, `server/db/schema.ts`) — reçoit `EVENT` plutôt que
 * de rester `null` indéfiniment. Complémentaire de `familyFightTypeUpdateSql`/`SelectSql` par
 * construction (`NOT EXISTS` ici vs le `JOIN` sur `representativeFamilyPerFightSql` là-bas, même
 * condition `monster_id is not null`) : un combat hors donjon reçoit toujours EXACTEMENT l'un des
 * deux (`FAMILY_*`/`FAMILY_NONE` ou `EVENT`), jamais les deux, jamais aucun.
 */
function eventFightTypeValueExpr(): SQL {
  return sql`'EVENT'`;
}

function eventFightTypeUnresolvedCondition(): SQL {
  return sql`not exists (
    select 1 from fight_participants fp
    where fp.fight_id = f.id and fp.side = 'enemy' and fp.monster_id is not null
  )`;
}

/** Écrit `fight_type = 'EVENT'` pour tous les combats HORS donjon (`dungeon_id` NULL) dont aucun
 * ennemi n'est catalogué, matchant `scope` — voir `eventFightTypeUnresolvedCondition`. */
export function eventFightTypeUpdateSql(scope: SQL): SQL {
  return sql`
    update fights as f
    set fight_type = ${eventFightTypeValueExpr()}
    where f.dungeon_id is null and (${scope}) and ${eventFightTypeUnresolvedCondition()}
  `;
}

/** Aperçu (lecture seule) de la valeur `fight_type` que `eventFightTypeUpdateSql` écrirait pour
 * chaque combat matchant `scope` — `id`/`current`/`computed` (toujours `'EVENT'`) par ligne. */
export function eventFightTypeSelectSql(scope: SQL): SQL {
  return sql`
    select f.id as id, f.fight_type as current, ${eventFightTypeValueExpr()} as computed
    from fights f
    where f.dungeon_id is null and (${scope}) and ${eventFightTypeUnresolvedCondition()}
  `;
}

/** Distribution de `fight_type` (compte de combats par valeur, `null` inclus) matchant `scope` —
 * utilisée par le script de rattrapage pour un aperçu avant/après. */
export function fightTypeDistributionSql(scope: SQL): SQL {
  return sql`
    select fight_type, count(*) as count
    from fights f
    where (${scope})
    group by fight_type
    order by count(*) desc
  `;
}
