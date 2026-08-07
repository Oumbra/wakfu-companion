CREATE TABLE "game_servers" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
-- Noms propres, non traduits (voir le commentaire de schema.ts).
INSERT INTO "game_servers" ("code", "label") VALUES
	('pandora', 'Pandora'),
	('rubilax', 'Rubilax'),
	('ogrest', 'Ogrest');
