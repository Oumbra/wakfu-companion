-- Volume d'historique par compte (audit de sécurité du 2026-09-23, lot 6) : les quotas en lignes
-- ne bornaient pas le stockage. Voir server/history/storage.ts.
CREATE TABLE "account_storage" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"history_bytes" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_storage" ADD CONSTRAINT "account_storage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;--> statement-breakpoint
-- Point de départ : taille réelle (pg_column_size) de ce que chaque compte stocke déjà.
INSERT INTO "account_storage" ("user_id", "history_bytes")
SELECT "user_id", sum("bytes")::bigint FROM (
  SELECT f."user_id", pg_column_size(f.*) AS "bytes" FROM "fights" f
  UNION ALL SELECT f."user_id", pg_column_size(p.*) FROM "fight_participants" p JOIN "fights" f ON f."id" = p."fight_id"
  UNION ALL SELECT f."user_id", pg_column_size(l.*) FROM "fight_loot" l JOIN "fights" f ON f."id" = l."fight_id"
  UNION ALL SELECT pu."user_id", pg_column_size(pu.*) FROM "purchases" pu
  UNION ALL SELECT t."user_id", pg_column_size(t.*) FROM "trades" t
  UNION ALL SELECT t."user_id", pg_column_size(ti.*) FROM "trade_items" ti JOIN "trades" t ON t."id" = ti."trade_id"
  UNION ALL SELECT pe."user_id", pg_column_size(pe.*) FROM "pact_extractions" pe
  UNION ALL SELECT pe."user_id", pg_column_size(pxi.*) FROM "pact_extraction_items" pxi JOIN "pact_extractions" pe ON pe."id" = pxi."extraction_id"
) AS "sizes"
GROUP BY "user_id"
ON CONFLICT ("user_id") DO NOTHING;
