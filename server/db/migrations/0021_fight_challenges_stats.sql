ALTER TABLE "fights" ADD COLUMN "challenges_passed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fights" ADD COLUMN "challenges_failed" integer DEFAULT 0 NOT NULL;