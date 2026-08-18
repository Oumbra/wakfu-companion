-- item_categories est entièrement remplacée (DELETE puis INSERT) à chaque exécution de
-- server/import/import-catalog.ts, et aucune autre table ne référence ses id par FK stricte (voir
-- server/db/schema.ts) : vider la table avant d'ajouter les colonnes NOT NULL ci-dessous est donc
-- sans perte, et évite un échec de migration sur une base où la table contient déjà des lignes
-- "fr seul" (avant l'ajout de en/es/pt). La table sera repeuplée au prochain run du workflow
-- "Import catalog".
DELETE FROM "item_categories";--> statement-breakpoint
ALTER TABLE "item_categories" ADD COLUMN "en" text NOT NULL;--> statement-breakpoint
ALTER TABLE "item_categories" ADD COLUMN "es" text NOT NULL;--> statement-breakpoint
ALTER TABLE "item_categories" ADD COLUMN "pt" text NOT NULL;
