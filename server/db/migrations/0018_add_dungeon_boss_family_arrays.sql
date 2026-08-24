DROP INDEX "dungeons_boss_monster_id_idx";--> statement-breakpoint
ALTER TABLE "dungeons" ALTER COLUMN "boss_monster_id" SET DATA TYPE integer[] USING CASE WHEN "boss_monster_id" IS NULL THEN '{}'::integer[] ELSE ARRAY["boss_monster_id"] END;--> statement-breakpoint
ALTER TABLE "dungeons" ALTER COLUMN "boss_monster_id" SET DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "dungeons" ALTER COLUMN "boss_monster_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dungeons" ADD COLUMN "monster_family_id" integer[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "dungeons_boss_monster_id_idx" ON "dungeons" USING gin ("boss_monster_id");
