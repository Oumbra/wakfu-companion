CREATE TABLE "item_prices_daily" (
	"item_id" integer NOT NULL,
	"game_server" text NOT NULL,
	"captured_on" date NOT NULL,
	"price" bigint NOT NULL,
	CONSTRAINT "item_prices_daily_item_id_game_server_captured_on_pk" PRIMARY KEY("item_id","game_server","captured_on")
);
--> statement-breakpoint
CREATE TABLE "item_prices_monthly" (
	"item_id" integer NOT NULL,
	"game_server" text NOT NULL,
	"month" date NOT NULL,
	"price_min" bigint NOT NULL,
	"price_max" bigint NOT NULL,
	"price_avg" bigint NOT NULL,
	"samples_count" integer NOT NULL,
	CONSTRAINT "item_prices_monthly_item_id_game_server_month_pk" PRIMARY KEY("item_id","game_server","month")
);
--> statement-breakpoint
CREATE TABLE "price_scan_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"game_server" text NOT NULL,
	"captured_on" date NOT NULL,
	"items_captured" integer NOT NULL,
	"items_unresolved" integer DEFAULT 0 NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "price_trends" (
	"item_id" integer NOT NULL,
	"game_server" text NOT NULL,
	"avg_last_30d" bigint NOT NULL,
	"avg_prev_30d" bigint NOT NULL,
	"change_pct" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_trends_item_id_game_server_pk" PRIMARY KEY("item_id","game_server")
);
--> statement-breakpoint
ALTER TABLE "item_prices_daily" ADD CONSTRAINT "item_prices_daily_game_server_game_servers_code_fk" FOREIGN KEY ("game_server") REFERENCES "public"."game_servers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_prices_monthly" ADD CONSTRAINT "item_prices_monthly_game_server_game_servers_code_fk" FOREIGN KEY ("game_server") REFERENCES "public"."game_servers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_scan_runs" ADD CONSTRAINT "price_scan_runs_game_server_game_servers_code_fk" FOREIGN KEY ("game_server") REFERENCES "public"."game_servers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_trends" ADD CONSTRAINT "price_trends_game_server_game_servers_code_fk" FOREIGN KEY ("game_server") REFERENCES "public"."game_servers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_prices_daily_item_server_idx" ON "item_prices_daily" USING btree ("item_id","game_server");--> statement-breakpoint
CREATE INDEX "item_prices_daily_server_date_idx" ON "item_prices_daily" USING btree ("game_server","captured_on");--> statement-breakpoint
CREATE INDEX "item_prices_monthly_item_server_idx" ON "item_prices_monthly" USING btree ("item_id","game_server");--> statement-breakpoint
CREATE INDEX "price_trends_server_change_pct_idx" ON "price_trends" USING btree ("game_server","change_pct");