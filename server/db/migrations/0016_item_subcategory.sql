CREATE TABLE "item_categories" (
	"id" integer PRIMARY KEY NOT NULL,
	"fr" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "sub_category_id" integer;--> statement-breakpoint
CREATE INDEX "items_sub_category_id_idx" ON "items" USING btree ("sub_category_id");