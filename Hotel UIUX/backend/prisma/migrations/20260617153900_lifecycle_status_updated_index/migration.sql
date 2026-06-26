CREATE INDEX IF NOT EXISTS "entity_lifecycle_status_updated_idx"
ON "entity_lifecycle"("status", "updated_at" DESC);
