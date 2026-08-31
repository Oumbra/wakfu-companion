ALTER TABLE "fights" ADD COLUMN "dungeon_id" integer;--> statement-breakpoint
ALTER TABLE "fights" ADD COLUMN "dungeon_run_key" text;--> statement-breakpoint
ALTER TABLE "fights" ADD CONSTRAINT "fights_dungeon_id_dungeons_id_fk" FOREIGN KEY ("dungeon_id") REFERENCES "public"."dungeons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fights_user_dungeon_run_key_idx" ON "fights" USING btree ("user_id","dungeon_run_key");