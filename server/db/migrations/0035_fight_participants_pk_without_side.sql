-- Clé primaire de fight_participants : (fight_id, side, name, instance_index) → (fight_id, name,
-- instance_index) — audit de sécurité du 2026-09-23 (#1), voir server/history/ingest.ts
-- (selectWritableParticipants) et server/README.md.
--
-- Dédoublonnage préalable (écrit à la main) : tant que `side` faisait partie de la clé, un
-- combattant dont la classification allié/ennemi avait changé entre deux envois du même combat
-- avait DEUX lignes (une par camp). On n'en garde qu'une par (fight_id, name, instance_index) :
--   1. la plus riche (dégâts + soin + armure, puis nombre de sorts ventilés) — une ligne écrite par
--      un envoi plus complet ;
--   2. à égalité, la plus récemment écrite (ctid le plus grand : un INSERT comme un UPDATE écrit
--      un nouveau tuple en fin de table dans l'immense majorité des cas) — c'est elle qui porte la
--      classification la plus récente.
-- L'XP d'un participant n'est portée que par une des deux copies au plus (même valeur) : rien à
-- fusionner. `fight_type` des combats touchés peut être recalculé ensuite par
-- `npm run main:backfill:fight-type` (facultatif : il l'est de toute façon au prochain renvoi).
DELETE FROM "fight_participants" AS fp
USING (
  SELECT ctid AS row_ctid,
    row_number() OVER (
      PARTITION BY fight_id, name, instance_index
      ORDER BY
        (damage + heal + armor) DESC,
        (CASE WHEN jsonb_typeof(spells) = 'array' THEN jsonb_array_length(spells) ELSE 0 END
          + CASE WHEN jsonb_typeof(heal_spells) = 'array' THEN jsonb_array_length(heal_spells) ELSE 0 END
          + CASE WHEN jsonb_typeof(armor_spells) = 'array' THEN jsonb_array_length(armor_spells) ELSE 0 END) DESC,
        ctid DESC
    ) AS rn
  FROM "fight_participants"
) AS ranked
WHERE fp.ctid = ranked.row_ctid AND ranked.rn > 1;--> statement-breakpoint
ALTER TABLE "fight_participants" DROP CONSTRAINT "fight_participants_fight_id_side_name_instance_index_pk";--> statement-breakpoint
ALTER TABLE "fight_participants" ADD CONSTRAINT "fight_participants_fight_id_name_instance_index_pk" PRIMARY KEY("fight_id","name","instance_index");
