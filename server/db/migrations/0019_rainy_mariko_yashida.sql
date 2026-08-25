ALTER TABLE "fights" ADD COLUMN "fight_log_id" bigint;--> statement-breakpoint
CREATE INDEX "fights_fight_log_id_idx" ON "fights" USING btree ("fight_log_id");