CREATE TABLE "fight_participants" (
	"fight_id" bigint NOT NULL,
	"side" text NOT NULL,
	"name" text NOT NULL,
	"instance_index" integer DEFAULT 1 NOT NULL,
	"class_name" text,
	"damage" bigint DEFAULT 0 NOT NULL,
	"defeated" boolean DEFAULT false NOT NULL,
	CONSTRAINT "fight_participants_fight_id_side_name_instance_index_pk" PRIMARY KEY("fight_id","side","name","instance_index")
);
--> statement-breakpoint
CREATE TABLE "fights" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"client_key" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer,
	"won" boolean,
	"turns" integer,
	"total_damage" bigint,
	"xp_gained" bigint,
	"kamas_gained" bigint,
	"game_server" text
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"client_key" text NOT NULL,
	"item_id" integer,
	"item_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"total_cost" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"game_server" text
);
--> statement-breakpoint
CREATE TABLE "trade_items" (
	"trade_id" bigint NOT NULL,
	"direction" text NOT NULL,
	"line_index" integer NOT NULL,
	"item_id" integer,
	"item_name" text NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "trade_items_trade_id_direction_line_index_pk" PRIMARY KEY("trade_id","direction","line_index")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"client_key" text NOT NULL,
	"peer_name" text NOT NULL,
	"self_name" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"kamas_acquired" bigint DEFAULT 0 NOT NULL,
	"kamas_given" bigint DEFAULT 0 NOT NULL,
	"game_server" text
);
--> statement-breakpoint
ALTER TABLE "fight_participants" ADD CONSTRAINT "fight_participants_fight_id_fights_id_fk" FOREIGN KEY ("fight_id") REFERENCES "public"."fights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fights" ADD CONSTRAINT "fights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fights" ADD CONSTRAINT "fights_game_server_game_servers_code_fk" FOREIGN KEY ("game_server") REFERENCES "public"."game_servers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_game_server_game_servers_code_fk" FOREIGN KEY ("game_server") REFERENCES "public"."game_servers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_game_server_game_servers_code_fk" FOREIGN KEY ("game_server") REFERENCES "public"."game_servers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fights_user_client_key_uq" ON "fights" USING btree ("user_id","client_key");--> statement-breakpoint
CREATE INDEX "fights_user_started_at_idx" ON "fights" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_user_client_key_uq" ON "purchases" USING btree ("user_id","client_key");--> statement-breakpoint
CREATE INDEX "purchases_user_occurred_at_idx" ON "purchases" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_user_client_key_uq" ON "trades" USING btree ("user_id","client_key");--> statement-breakpoint
CREATE INDEX "trades_user_occurred_at_idx" ON "trades" USING btree ("user_id","occurred_at");