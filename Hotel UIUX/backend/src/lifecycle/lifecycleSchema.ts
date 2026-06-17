import type { PrismaClient } from "@prisma/client";
import { ensureTableColumn, isSqliteDatabase } from "../dbDialect.js";

/**
 * Tạo các bảng của lớp DATA LIFECYCLE (additive — không đụng bảng/nghiệp vụ cũ).
 * PostgreSQL: tạo qua Prisma migration; SQLite legacy: IF NOT EXISTS khi khởi động.
 */
export async function ensureLifecycleTables(prisma: PrismaClient) {
  if (!isSqliteDatabase()) return;

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "entity_lifecycle" (
      "id"           TEXT NOT NULL PRIMARY KEY,
      "company_id"   TEXT,
      "entity_type"  TEXT NOT NULL,
      "entity_id"    TEXT NOT NULL,
      "status"       TEXT NOT NULL,
      "version"      INTEGER NOT NULL DEFAULT 1,
      "data_json"    TEXT,
      "deleted_at"   TEXT,
      "deleted_by"   TEXT,
      "archived_at"  TEXT,
      "purge_after"  TEXT,
      "reason"       TEXT,
      "created_at"   TEXT NOT NULL DEFAULT (datetime('now')),
      "updated_at"   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "entity_lifecycle_key" ON "entity_lifecycle" ("entity_type","entity_id")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "entity_lifecycle_status_idx" ON "entity_lifecycle" ("status")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "entity_lifecycle_purge_idx" ON "entity_lifecycle" ("status","purge_after")`,
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "record_versions" (
      "id"            TEXT NOT NULL PRIMARY KEY,
      "company_id"    TEXT,
      "entity_type"   TEXT NOT NULL,
      "entity_id"     TEXT NOT NULL,
      "version"       INTEGER NOT NULL,
      "action"        TEXT NOT NULL,
      "data_json"     TEXT NOT NULL,
      "actor_user_id" TEXT,
      "created_at"    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "record_versions_entity_idx" ON "record_versions" ("entity_type","entity_id","version")`,
  );

  await ensureTableColumn(prisma, "entity_lifecycle", "approved", "INTEGER NOT NULL DEFAULT 0");
  await ensureTableColumn(prisma, "entity_lifecycle", "requested_by", "TEXT");
  await ensureTableColumn(prisma, "entity_lifecycle", "requested_at", "TEXT");
  await ensureTableColumn(prisma, "entity_lifecycle", "approved_by", "TEXT");
  await ensureTableColumn(prisma, "entity_lifecycle", "approved_at", "TEXT");
}
