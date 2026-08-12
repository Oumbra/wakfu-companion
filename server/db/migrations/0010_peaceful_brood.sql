ALTER TABLE "dungeons" ADD COLUMN "room_count" integer;--> statement-breakpoint
ALTER TABLE "dungeons" ADD COLUMN "has_pre_boss_archi" boolean DEFAULT false NOT NULL;