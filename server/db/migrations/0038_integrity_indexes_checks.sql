-- Audit de sécurité du 2026-09-23, lot 14 : index des purges de rétention (lancées aussi depuis
-- des routes publiques) et invariants de l'historique doublés en base. Les CHECK sont posés
-- NOT VALID : appliqués à toute nouvelle ligne, sans faire échouer le déploiement sur une
-- éventuelle ligne ancienne. `ALTER TABLE … VALIDATE CONSTRAINT …` pourra les valider ensuite.
CREATE INDEX "auth_rate_limits_window_start_idx" ON "auth_rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "users_last_seen_at_idx" ON "users" USING btree ("last_seen_at");--> statement-breakpoint
ALTER TABLE "fight_participants" ADD CONSTRAINT "fight_participants_side" CHECK ("fight_participants"."side" in ('ally', 'enemy')) NOT VALID;--> statement-breakpoint
ALTER TABLE "fights" ADD CONSTRAINT "fights_client_key_format" CHECK ("fights"."client_key" ~ '^[0-9a-f]{64}$') NOT VALID;--> statement-breakpoint
ALTER TABLE "pact_extractions" ADD CONSTRAINT "pact_extractions_client_key_format" CHECK ("pact_extractions"."client_key" ~ '^[0-9a-f]{64}$') NOT VALID;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_client_key_format" CHECK ("purchases"."client_key" ~ '^[0-9a-f]{64}$') NOT VALID;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_direction" CHECK ("trade_items"."direction" in ('acquired', 'given')) NOT VALID;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_client_key_format" CHECK ("trades"."client_key" ~ '^[0-9a-f]{64}$') NOT VALID;