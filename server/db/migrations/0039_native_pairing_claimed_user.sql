-- Audit de sécurité du 2026-09-23, lot 13 : la confirmation d'un appairage natif n'enregistre
-- plus que le compte (`claimed_user_id`) ; la session et son jeton naissent au `/poll`. La colonne
-- `session_token` reste pour les appairages confirmés juste avant le déploiement (5 min au plus).
ALTER TABLE "native_pairings" ADD COLUMN "claimed_user_id" uuid;--> statement-breakpoint
ALTER TABLE "native_pairings" ADD CONSTRAINT "native_pairings_claimed_user_id_users_id_fk" FOREIGN KEY ("claimed_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;