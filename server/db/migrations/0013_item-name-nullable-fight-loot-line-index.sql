-- item_id/item_name deviennent mutuellement exclusifs sur fight_loot/purchases/trade_items (voir
-- server/db/schema.ts et server/history/parse.ts) : item_id résolu (catalogue) => item_name NULL,
-- sinon item_name porte le nom brut du log. Un objet corrigé manuellement après coup (voir
-- ItemPickerService côté client) peut faire passer une ligne de "non résolue" à "résolue".
--
-- Conséquence directe sur fight_loot : NULL n'est jamais valide dans une clé primaire Postgres, or
-- item_name (jusqu'ici clé primaire avec fight_id) devient NULL pour la plupart des lignes déjà
-- résolues aujourd'hui. line_index (position du butin dans le lot envoyé, attribuée côté serveur —
-- voir parse.ts, même principe que trade_items.line_index) la remplace.
--
-- Migration écrite à la main plutôt que le SQL généré par `drizzle-kit generate` tel quel : celui-ci
-- ajoutait line_index en NOT NULL sans valeur de repli (échec immédiat sur toute ligne déjà en
-- base) et tentait même de poser la nouvelle clé primaire AVANT que la colonne existe. Ordre correct
-- ci-dessous : colonne nullable d'abord, backfill déterministe, NOT NULL, puis bascule de clé.
ALTER TABLE "fight_loot" DROP CONSTRAINT "fight_loot_fight_id_item_name_pk";--> statement-breakpoint
ALTER TABLE "fight_loot" ADD COLUMN "line_index" integer;--> statement-breakpoint
UPDATE "fight_loot" AS fl
SET "line_index" = ranked.rn - 1
FROM (
  SELECT ctid, row_number() OVER (PARTITION BY fight_id ORDER BY ctid) AS rn
  FROM "fight_loot"
) AS ranked
WHERE fl.ctid = ranked.ctid;--> statement-breakpoint
ALTER TABLE "fight_loot" ALTER COLUMN "line_index" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fight_loot" ADD CONSTRAINT "fight_loot_fight_id_line_index_pk" PRIMARY KEY("fight_id","line_index");--> statement-breakpoint
ALTER TABLE "fight_loot" ALTER COLUMN "item_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "item_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_items" ALTER COLUMN "item_name" DROP NOT NULL;
