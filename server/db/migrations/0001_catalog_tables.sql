CREATE TABLE "catalog_meta" (
	"id" text PRIMARY KEY NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"source_commit" text,
	"items_count" integer NOT NULL,
	"monsters_count" integer NOT NULL,
	"dungeons_count" integer NOT NULL,
	"index_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dungeons" (
	"id" integer PRIMARY KEY NOT NULL,
	"fr" text NOT NULL,
	"en" text NOT NULL,
	"es" text NOT NULL,
	"pt" text NOT NULL,
	"level" integer NOT NULL,
	"tranche" integer NOT NULL,
	"is_breach" boolean NOT NULL,
	"is_ultimate_breach" boolean NOT NULL,
	"boss_monster_id" integer,
	"picture_url" text NOT NULL,
	"wakassets_available" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_recipes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"item_ankama_id" integer NOT NULL,
	"ingredient_ankama_id" integer NOT NULL,
	"quantity" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"pk" bigserial PRIMARY KEY NOT NULL,
	"ankama_id" integer,
	"fr" text NOT NULL,
	"en" text NOT NULL,
	"es" text NOT NULL,
	"pt" text NOT NULL,
	"rarity" text NOT NULL,
	"gfx_id" integer NOT NULL,
	"picture_url" text NOT NULL,
	"wakassets_available" boolean NOT NULL,
	"wakfu_available" boolean NOT NULL,
	"has_recipe" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monsters" (
	"id" integer PRIMARY KEY NOT NULL,
	"fr" text NOT NULL,
	"en" text NOT NULL,
	"es" text NOT NULL,
	"pt" text NOT NULL,
	"gfx_id" text NOT NULL,
	"family" integer,
	"picture_url" text NOT NULL,
	"wakassets_available" boolean NOT NULL,
	"wakfu_available" boolean NOT NULL,
	"is_boss" boolean NOT NULL,
	"is_archi" boolean NOT NULL,
	"is_dominant" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dungeons_boss_monster_id_idx" ON "dungeons" USING btree ("boss_monster_id");--> statement-breakpoint
CREATE INDEX "item_recipes_item_ankama_id_idx" ON "item_recipes" USING btree ("item_ankama_id");--> statement-breakpoint
CREATE INDEX "items_ankama_id_idx" ON "items" USING btree ("ankama_id");