-- Colonne jamais lue ni écrite (repli global du serveur de jeu abandonné au lot 7,
-- voir server/db/schema.ts) : retirée au titre de la minimisation (RGPD art. 5.1.c,
-- docs/analyse-rgpd.md, audit du 2026-09-21, point 7). Toujours NULL en base : aucune
-- donnée perdue.
ALTER TABLE "users" DROP COLUMN "default_game_server";
