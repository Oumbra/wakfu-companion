ALTER TABLE "monsters" ADD COLUMN "loot" integer[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "monsters_loot_idx" ON "monsters" USING gin ("loot");