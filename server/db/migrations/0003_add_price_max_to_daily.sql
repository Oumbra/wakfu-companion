-- Ajout en 3 temps pour ne pas casser sur une table déjà peuplée par le
-- skill de scan vidéo (prompt 4.1) : NOT NULL directement échouerait sans
-- valeur par défaut. Backfill priceMax = price pour toutes les lignes
-- existantes (seul prix qu'on avait vu ce jour-là, voir commentaire de
-- itemPricesDaily dans schema.ts) avant de contraindre la colonne.
ALTER TABLE "item_prices_daily" ADD COLUMN "price_max" bigint;
--> statement-breakpoint
UPDATE "item_prices_daily" SET "price_max" = "price" WHERE "price_max" IS NULL;
--> statement-breakpoint
ALTER TABLE "item_prices_daily" ALTER COLUMN "price_max" SET NOT NULL;