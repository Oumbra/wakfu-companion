ALTER TABLE "native_pairings" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "native_pairings" ADD COLUMN "requester_country" text;--> statement-breakpoint
ALTER TABLE "native_pairings" ADD COLUMN "requester_user_agent" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "chain_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "absolute_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "grace_rotated_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "sessions_chain_id_idx" ON "sessions" USING btree ("chain_id");--> statement-breakpoint
-- Rétro-remplissage (écrit à la main) : chaque session existante devient la racine de sa propre
-- chaîne, et reçoit une échéance absolue de 180 jours depuis son émission (SESSION_MAX_LIFETIME_MS,
-- server/auth/flow.ts). Le code tolère de toute façon les deux colonnes nulles.
UPDATE "sessions" SET "chain_id" = "id" WHERE "chain_id" IS NULL;--> statement-breakpoint
UPDATE "sessions" SET "absolute_expires_at" = "issued_at" + interval '180 days' WHERE "absolute_expires_at" IS NULL;
