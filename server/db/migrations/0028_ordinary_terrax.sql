ALTER TABLE "fight_participants" ADD COLUMN "heal" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fight_participants" ADD COLUMN "armor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fight_participants" ADD COLUMN "heal_spells" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fight_participants" ADD COLUMN "armor_spells" jsonb DEFAULT '[]'::jsonb NOT NULL;