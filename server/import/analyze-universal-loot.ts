// Script d'analyse ponctuelle (voir demande utilisateur) : identifie, parmi le butin déjà stocké
// en base, les objets actuellement marqués 'doubtful' par resolveLootConfidence
// (core/utils/loot-confidence.util.ts) — c'est-à-dire des objets ramassés pendant un combat dont
// AU MOINS un monstre a une table de drop connue (monsters.loot non vide), mais qui ne figurent
// dans AUCUNE des tables de drop des monstres réellement présents. Objectif : repérer les objets
// "universels" (Havre-Gemme, objets d'événement...) qui tombent indépendamment des monstres
// combattus, pour constituer un référentiel séparé à exclure du doute.
//
// Lecture seule, aucune écriture — conservé (voir `npm run dev:analyze:universal-loot` /
// `main:analyze:universal-loot`) pour être rejoué au fil de l'eau à mesure que la base grandit,
// plutôt que jeté après ce premier passage : `distinct_dungeons` est le signal le plus fiable pour
// juger si un objet est réellement universel (vu dans plusieurs donjons différents) ou s'il s'agit
// simplement d'un trou du référentiel `monsters.loot` pour UN monstre d'un seul donjon (à corriger
// via le skill wakfu-monsters-sync plutôt qu'à ajouter à un référentiel d'objets universels).
import { createDb } from '../db/client';
import { sql } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';

async function main() {
  const db = createDb(process.env.DATABASE_URL!);

  // --- Objets résolus (item_id connu) marqués 'doubtful' ---------------------------------------
  const byId = (
    await db.execute(sql`
      with enemy_loot as (
        select fp.fight_id, unnest(m.loot) as loot_item_id
        from fight_participants fp
        join monsters m on m.id = fp.monster_id
        where fp.side = 'enemy'
      ),
      fight_known as (
        select fp.fight_id,
          bool_or(m.loot is not null and array_length(m.loot, 1) > 0) as has_known_loot
        from fight_participants fp
        left join monsters m on m.id = fp.monster_id
        where fp.side = 'enemy'
        group by fp.fight_id
      ),
      enemy_names as (
        select fp.fight_id, array_agg(distinct fp.name) as names
        from fight_participants fp
        where fp.side = 'enemy'
        group by fp.fight_id
      ),
      classified as (
        select
          fl.fight_id,
          fl.item_id,
          fl.quantity,
          f.dungeon_id,
          fk.has_known_loot,
          exists (
            select 1 from enemy_loot el
            where el.fight_id = fl.fight_id and el.loot_item_id = fl.item_id
          ) as matched
        from fight_loot fl
        join fights f on f.id = fl.fight_id
        join fight_known fk on fk.fight_id = fl.fight_id
        where fl.item_id is not null
      )
      select
        c.item_id as item_id,
        i.fr as item_fr,
        count(*)::int as occurrences,
        count(distinct c.fight_id)::int as distinct_fights,
        count(distinct coalesce(c.dungeon_id, -1))::int as distinct_dungeons,
        sum(c.quantity)::int as total_quantity,
        (
          select array_agg(distinct x)
          from (
            select unnest(en.names) as x
            from classified c2
            join enemy_names en on en.fight_id = c2.fight_id
            where c2.item_id = c.item_id
          ) t
        ) as seen_with_enemies
      from classified c
      left join items i on i.ankama_id = c.item_id
      where c.has_known_loot = true and not c.matched
      group by c.item_id, i.fr
      order by distinct_dungeons desc, distinct_fights desc
    `)
  ).rows as {
    item_id: number;
    item_fr: string | null;
    occurrences: number;
    distinct_fights: number;
    distinct_dungeons: number;
    total_quantity: number;
    seen_with_enemies: string[] | null;
  }[];

  // --- Objets NON résolus (item_name seul, id absent du catalogue) marqués 'doubtful' -----------
  const byName = (
    await db.execute(sql`
      with fight_known as (
        select fp.fight_id,
          bool_or(m.loot is not null and array_length(m.loot, 1) > 0) as has_known_loot
        from fight_participants fp
        left join monsters m on m.id = fp.monster_id
        where fp.side = 'enemy'
        group by fp.fight_id
      ),
      enemy_names as (
        select fp.fight_id, array_agg(distinct fp.name) as names
        from fight_participants fp
        where fp.side = 'enemy'
        group by fp.fight_id
      )
      select
        fl.item_name as item_name,
        count(*)::int as occurrences,
        count(distinct fl.fight_id)::int as distinct_fights,
        count(distinct coalesce(f.dungeon_id, -1))::int as distinct_dungeons,
        sum(fl.quantity)::int as total_quantity,
        (
          select array_agg(distinct x)
          from (
            select unnest(en.names) as x
            from fight_loot fl2
            join enemy_names en on en.fight_id = fl2.fight_id
            where fl2.item_name = fl.item_name and fl2.item_id is null
          ) t
        ) as seen_with_enemies
      from fight_loot fl
      join fights f on f.id = fl.fight_id
      join fight_known fk on fk.fight_id = fl.fight_id
      where fl.item_id is null and fk.has_known_loot = true
      group by fl.item_name
      order by distinct_dungeons desc, distinct_fights desc
    `)
  ).rows as {
    item_name: string;
    occurrences: number;
    distinct_fights: number;
    distinct_dungeons: number;
    total_quantity: number;
    seen_with_enemies: string[] | null;
  }[];

  // Sortie JSON optionnelle (voir demande utilisateur, jeu de données trop volumineux sur
  // production pour être lu confortablement depuis la sortie console.table) : JSON_OUT=chemin.json
  // écrit les deux jeux de résultats bruts, sans troncature du tableau seenWithEnemies.
  if (process.env.JSON_OUT) {
    writeFileSync(process.env.JSON_OUT, JSON.stringify({ byId, byName }, null, 2));
    console.log(`Écrit : ${process.env.JSON_OUT}`);
    return;
  }

  console.log('=== Objets résolus (item_id) marqués doubtful ===');
  console.table(
    byId.map((r) => ({
      itemId: r.item_id,
      fr: r.item_fr ?? '(introuvable dans items)',
      occurrences: r.occurrences,
      combats: r.distinct_fights,
      donjons: r.distinct_dungeons,
      quantité: r.total_quantity,
      vuAvec: (r.seen_with_enemies ?? []).slice(0, 6).join(', '),
    })),
  );

  console.log('\n=== Objets NON résolus (nom seul) marqués doubtful ===');
  console.table(
    byName.map((r) => ({
      nom: r.item_name,
      occurrences: r.occurrences,
      combats: r.distinct_fights,
      donjons: r.distinct_dungeons,
      quantité: r.total_quantity,
      vuAvec: (r.seen_with_enemies ?? []).slice(0, 6).join(', '),
    })),
  );

  console.log(
    `\nTotal : ${byId.length} objet(s) résolu(s), ${byName.length} objet(s) non résolu(s).`,
  );
}

main();
