ALTER TABLE "fights" ADD COLUMN "fight_type" text;--> statement-breakpoint
CREATE INDEX "fights_user_fight_type_idx" ON "fights" USING btree ("user_id","fight_type");