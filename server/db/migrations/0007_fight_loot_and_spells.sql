CREATE TABLE "fight_loot" (
	"fight_id" bigint NOT NULL,
	"item_id" integer,
	"item_name" text NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "fight_loot_fight_id_item_name_pk" PRIMARY KEY("fight_id","item_name")
);
--> statement-breakpoint
ALTER TABLE "fight_participants" ADD COLUMN "spells" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fight_loot" ADD CONSTRAINT "fight_loot_fight_id_fights_id_fk" FOREIGN KEY ("fight_id") REFERENCES "public"."fights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fight_loot_item_id_idx" ON "fight_loot" USING btree ("item_id");