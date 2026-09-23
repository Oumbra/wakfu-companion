CREATE INDEX "items_fr_trgm_idx" ON "items" USING gin ("fr" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "items_en_trgm_idx" ON "items" USING gin ("en" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "items_es_trgm_idx" ON "items" USING gin ("es" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "items_pt_trgm_idx" ON "items" USING gin ("pt" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "monsters_fr_trgm_idx" ON "monsters" USING gin ("fr" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "monsters_en_trgm_idx" ON "monsters" USING gin ("en" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "monsters_es_trgm_idx" ON "monsters" USING gin ("es" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "monsters_pt_trgm_idx" ON "monsters" USING gin ("pt" gin_trgm_ops);