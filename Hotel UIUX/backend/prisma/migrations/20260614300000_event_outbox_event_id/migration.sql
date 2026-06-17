-- Rename table + add event_id (idempotent wire id)
-- Safe for DB that already has "EventOutbox" from prior migration

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'EventOutbox'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'event_outbox'
  ) THEN
    ALTER TABLE "EventOutbox" RENAME TO "event_outbox";
  END IF;
END $$;

-- Add event_id if missing (fresh or upgraded)
ALTER TABLE "event_outbox" ADD COLUMN IF NOT EXISTS "event_id" TEXT;

UPDATE "event_outbox" SET "event_id" = "id" WHERE "event_id" IS NULL;

ALTER TABLE "event_outbox" ALTER COLUMN "event_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "event_outbox_event_id_key" ON "event_outbox"("event_id");

-- Rename columns to snake_case if still camelCase from old migration
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'event_outbox' AND column_name = 'eventType'
  ) THEN
    ALTER TABLE "event_outbox" RENAME COLUMN "eventType" TO "event_type";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'event_outbox' AND column_name = 'createdAt'
  ) THEN
    ALTER TABLE "event_outbox" RENAME COLUMN "createdAt" TO "created_at";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'event_outbox' AND column_name = 'updatedAt'
  ) THEN
    ALTER TABLE "event_outbox" RENAME COLUMN "updatedAt" TO "updated_at";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'event_outbox' AND column_name = 'sentAt'
  ) THEN
    ALTER TABLE "event_outbox" RENAME COLUMN "sentAt" TO "sent_at";
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "event_outbox_status_created_at_idx" ON "event_outbox"("status", "created_at");
CREATE INDEX IF NOT EXISTS "event_outbox_event_type_idx" ON "event_outbox"("event_type");
