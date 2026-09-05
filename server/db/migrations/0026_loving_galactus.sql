CREATE TABLE "native_pairings" (
	"device_code" text PRIMARY KEY NOT NULL,
	"user_code" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"session_token" text,
	"claimed_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "native_pairings_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
CREATE INDEX "native_pairings_expires_at_idx" ON "native_pairings" USING btree ("expires_at");