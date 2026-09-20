-- Purge des comptes inactifs (RGPD art. 5.1.e, décision du 2026-09-20) : le
-- délai de 12 mois court à compter de la mise en production de la règle, pour
-- tout le monde — pas de la dernière connexion antérieure, que personne n'avait
-- été informé de devoir renouveler. D'où la remise à now() de TOUTES les lignes.
UPDATE "users" SET "last_seen_at" = now();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "last_seen_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "last_seen_at" SET NOT NULL;
