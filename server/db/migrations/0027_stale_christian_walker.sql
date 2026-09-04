CREATE TABLE "pact_extraction_items" (
	"extraction_id" bigint NOT NULL,
	"line_index" integer NOT NULL,
	"item_id" integer,
	"item_name" text,
	"quantity" integer NOT NULL,
	CONSTRAINT "pact_extraction_items_extraction_id_line_index_pk" PRIMARY KEY("extraction_id","line_index")
);
--> statement-breakpoint
CREATE TABLE "pact_extractions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"client_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"game_server" text
);
--> statement-breakpoint
ALTER TABLE "pact_extraction_items" ADD CONSTRAINT "pact_extraction_items_extraction_id_pact_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."pact_extractions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pact_extractions" ADD CONSTRAINT "pact_extractions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pact_extractions" ADD CONSTRAINT "pact_extractions_game_server_game_servers_code_fk" FOREIGN KEY ("game_server") REFERENCES "public"."game_servers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pact_extraction_items_item_id_idx" ON "pact_extraction_items" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pact_extractions_user_client_key_uq" ON "pact_extractions" USING btree ("user_id","client_key");--> statement-breakpoint
CREATE INDEX "pact_extractions_user_occurred_at_idx" ON "pact_extractions" USING btree ("user_id","occurred_at");