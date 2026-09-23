-- Pseudonymes de tiers retirés (droit d'opposition, script erase-third-party-name) : consultés à
-- l'ingestion pour qu'un envoi ultérieur ne réécrive pas le nom d'origine (audit de sécurité du
-- 2026-09-23, lot 7 — voir server/history/erased-names.ts).
CREATE TABLE "erased_third_party_names" (
	"name_lower" text PRIMARY KEY NOT NULL,
	"erased_at" timestamp with time zone DEFAULT now() NOT NULL
);
