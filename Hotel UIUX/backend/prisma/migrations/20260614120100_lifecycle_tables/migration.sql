-- Lifecycle sidecar tables (not in Prisma schema — managed at runtime)
CREATE TABLE "entity_lifecycle" (
    "id" TEXT NOT NULL,
    "company_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "data_json" TEXT,
    "deleted_at" TEXT,
    "deleted_by" TEXT,
    "archived_at" TEXT,
    "purge_after" TEXT,
    "reason" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (NOW()::TEXT),
    "updated_at" TEXT NOT NULL DEFAULT (NOW()::TEXT),
    "approved" INTEGER NOT NULL DEFAULT 0,
    "requested_by" TEXT,
    "requested_at" TEXT,
    "approved_by" TEXT,
    "approved_at" TEXT,

    CONSTRAINT "entity_lifecycle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "entity_lifecycle_key" ON "entity_lifecycle" ("entity_type", "entity_id");
CREATE INDEX "entity_lifecycle_status_idx" ON "entity_lifecycle" ("status");
CREATE INDEX "entity_lifecycle_purge_idx" ON "entity_lifecycle" ("status", "purge_after");

CREATE TABLE "record_versions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "data_json" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "created_at" TEXT NOT NULL DEFAULT (NOW()::TEXT),

    CONSTRAINT "record_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "record_versions_entity_idx" ON "record_versions" ("entity_type", "entity_id", "version");
