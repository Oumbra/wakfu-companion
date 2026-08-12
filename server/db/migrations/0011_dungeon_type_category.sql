ALTER TABLE "dungeons" ADD COLUMN "type" text NOT NULL DEFAULT 'TWO_ROOMS';--> statement-breakpoint
ALTER TABLE "dungeons" ALTER COLUMN "type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "dungeons" DROP COLUMN "is_breach";--> statement-breakpoint
ALTER TABLE "dungeons" DROP COLUMN "is_ultimate_breach";--> statement-breakpoint
ALTER TABLE "dungeons" DROP COLUMN "room_count";
