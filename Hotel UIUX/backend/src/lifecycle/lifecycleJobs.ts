import { PrismaClient, Prisma } from "@prisma/client";
import crypto from "node:crypto";
import { notifyEntityLifecycle, DEFAULT_STATE_ROOM_ID } from "../stateSync.js";

/** Redis client tối thiểu cần cho distributed lock (tùy chọn). */
type RedisLike = { set: (key: string, value: string, opts: any) => Promise<unknown> } | null;

const TRASH_RETENTION_DAYS = Number(process.env.LC_TRASH_RETENTION_DAYS || 30);
const PURGE_GRACE_DAYS = Number(process.env.LC_PURGE_GRACE_DAYS || 7);

/** Chỉ 1 instance chạy job tại 1 thời điểm (sẵn sàng multi-instance / SaaS). */
async function withLock(redis: RedisLike, key: string, ttlSec: number, fn: () => Promise<void>) {
  if (redis) {
    try {
      const ok = await redis.set(`lc:lock:${key}`, crypto.randomUUID(), { NX: true, EX: ttlSec });
      if (!ok) return;
    } catch {
      // Redis lỗi → vẫn chạy ở chế độ single-instance
    }
  }
  await fn();
}

/** SOFT_DELETED quá hạn lưu giữ → PENDING_DELETE (đặt purge_after). */
async function cleanupTrashJob(prisma: PrismaClient, redis: RedisLike) {
  await withLock(redis, "cleanupTrash", 300, async () => {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86400_000).toISOString();
    const purgeAfter = new Date(Date.now() + PURGE_GRACE_DAYS * 86400_000).toISOString();
    const now = new Date().toISOString();
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT entity_type, entity_id, version, company_id FROM "entity_lifecycle"
      WHERE status='SOFT_DELETED' AND deleted_at IS NOT NULL AND deleted_at < ${cutoff} LIMIT 500`);
    for (const r of rows) {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "entity_lifecycle" SET status='PENDING_DELETE', purge_after=${purgeAfter}, updated_at=${now}
        WHERE entity_type=${r.entity_type} AND entity_id=${r.entity_id}`);
      notifyEntityLifecycle({
        action: "DATA_DELETED",
        entityType: r.entity_type,
        entityId: r.entity_id,
        version: r.version ?? 1,
        status: "PENDING_DELETE",
        companyId: r.company_id ?? DEFAULT_STATE_ROOM_ID,
      });
    }
    if (rows.length) console.log(`[lifecycle] cleanupTrash → PENDING_DELETE: ${rows.length}`);
  });
}

/** PENDING_DELETE đã qua purge_after → xóa thật (giữ version + audit). */
async function purgeJob(prisma: PrismaClient, redis: RedisLike) {
  await withLock(redis, "purge", 300, async () => {
    const now = new Date().toISOString();
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT id, entity_type, entity_id, version, data_json, company_id FROM "entity_lifecycle"
      WHERE status='PENDING_DELETE' AND purge_after IS NOT NULL AND purge_after < ${now} LIMIT 500`);
    for (const r of rows) {
      const nextVersion = (r.version ?? 1) + 1;
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "record_versions" (id, entity_type, entity_id, version, action, data_json, created_at)
          VALUES (${crypto.randomUUID()}, ${r.entity_type}, ${r.entity_id}, ${nextVersion}, 'PURGE', ${r.data_json ?? "null"}, ${now})`);
        const beforeSnapshot =
          r.data_json && typeof r.data_json === "string" ? JSON.parse(r.data_json) : r.data_json;
        await tx.auditLog.create({
          data: {
            companyId: r.company_id ?? null,
            action: "PURGE",
            resource: r.entity_type,
            resourceId: r.entity_id,
            before:
              beforeSnapshot == null ? Prisma.DbNull : (beforeSnapshot as Prisma.InputJsonValue),
          },
        });
        await tx.$executeRaw(Prisma.sql`DELETE FROM "entity_lifecycle" WHERE id=${r.id}`);
      });
      notifyEntityLifecycle({
        action: "DATA_PURGED",
        entityType: r.entity_type,
        entityId: r.entity_id,
        version: nextVersion,
        status: "DELETED",
        companyId: r.company_id ?? DEFAULT_STATE_ROOM_ID,
      });
    }
    if (rows.length) console.log(`[lifecycle] purged: ${rows.length}`);
  });
}

/** Khởi động scheduler (setInterval, không thêm dependency). */
export function startLifecycleJobs(prisma: PrismaClient, redis: RedisLike) {
  const DAY = 86400_000;
  setInterval(() => void cleanupTrashJob(prisma, redis).catch((e) => console.warn("[lifecycle] cleanupTrash", e)), DAY);
  setInterval(() => void purgeJob(prisma, redis).catch((e) => console.warn("[lifecycle] purge", e)), 6 * 3600_000);
  // Chạy sớm sau khi khởi động (lệch nhau để tránh đụng lock).
  setTimeout(() => void cleanupTrashJob(prisma, redis).catch(() => {}), 30_000);
  setTimeout(() => void purgeJob(prisma, redis).catch(() => {}), 60_000);
  console.log(
    `[lifecycle] jobs started (trashRetention=${TRASH_RETENTION_DAYS}d, purgeGrace=${PURGE_GRACE_DAYS}d)`,
  );
}

export const __lifecycleJobsForTest = { cleanupTrashJob, purgeJob };
