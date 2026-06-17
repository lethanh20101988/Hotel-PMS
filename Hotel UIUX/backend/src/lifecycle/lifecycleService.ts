import { PrismaClient, Prisma } from "@prisma/client";
import crypto from "node:crypto";
import { bumpStateDataVersion, notifyEntityLifecycle, DEFAULT_STATE_ROOM_ID } from "../stateSync.js";
import { purgeJournalEntriesInAppState, removeJournalEntryIdFromAppState } from "./journalCascade.js";
import type { EntityLifecycleAction } from "../realtime/stateTypes.js";

export type LifecycleStatus =
  | "ACTIVE"
  | "SOFT_DELETED"
  | "ARCHIVED"
  | "PENDING_DELETE"
  | "DELETED";

/** Các chuyển trạng thái hợp lệ (validate trước mọi update). */
const TRANSITIONS: Record<LifecycleStatus, LifecycleStatus[]> = {
  ACTIVE: ["SOFT_DELETED", "ARCHIVED"],
  SOFT_DELETED: ["ACTIVE", "ARCHIVED", "PENDING_DELETE"],
  ARCHIVED: ["ACTIVE", "PENDING_DELETE"],
  PENDING_DELETE: ["ACTIVE", "DELETED"],
  DELETED: [],
};

/** Map entity_type -> tên mảng trong AppState.data (nguồn dữ liệu ACTIVE). */
export const ENTITY_ARRAY_PATH: Record<string, string> = {
  invoice: "invoices",
  voucher: "accountingVouchers",
  fundTransaction: "fundTransactions",
  bankAccount: "bankAccounts",
  inventoryItem: "inventory",
  journalEntry: "journalEntries",
  device: "devices",
  asset: "assets",
  // Phiếu nhập/xuất kho (mảng transactions trong AppState.data).
  inventoryTransaction: "transactions",
  // Scratch type cho smoke test / e2e — ghi vào mảng riêng, không đụng dữ liệu nghiệp vụ.
  lcTest: "__lifecycleTest",
};

export class LifecycleError extends Error {
  code: string;
  constructor(code: string, msg: string) {
    super(msg);
    this.code = code;
    this.name = "LifecycleError";
  }
}

/** Tên quyền action-based dùng cho quy trình xóa có kiểm soát. */
export const DELETE_PERMISSIONS = {
  soft: "delete:soft",
  restore: "delete:restore",
  request: "delete:request",
  approve: "delete:approve",
  hard: "delete:hard",
} as const;

const HARD_DELETE_CONFIRM_TEXT = "DELETE";
const HARD_DELETE_DELAY_MS = Number(process.env.LC_HARD_DELETE_DELAY_MS || 5000);
/** Field thường gặp để xác định "chủ sở hữu" record (staff chỉ xóa dữ liệu của mình). */
const OWNER_FIELDS = ["createdBy", "created_by", "ownerId", "owner_id", "userId", "user_id"];

/**
 * "Foreign key" cho dữ liệu JSON blob: trả về mô tả nếu record đang được tham chiếu,
 * hoặc null nếu an toàn để xóa. Mở rộng dần theo nghiệp vụ.
 */
type RefGuard = (state: any, id: string) => string | null;
const REFERENCE_GUARDS: Record<string, RefGuard> = {
  bankAccount: (state, id) => {
    const txs = Array.isArray(state?.fundTransactions) ? state.fundTransactions : [];
    const n = txs.filter((t: any) => String(t?.bankAccountId ?? t?.bankAccount ?? "") === String(id)).length;
    return n > 0 ? `còn ${n} giao dịch quỹ đang tham chiếu tài khoản này` : null;
  },
};

export type LifecycleCtx = {
  actorUserId?: string | null;
  companyId?: string | null;
  sourceClientId?: string;
  reason?: string;
  /** Vai trò & quyền của người thao tác — service tự kiểm tra (defense-in-depth). */
  role?: string | null;
  permissions?: string[];
};

type Tx = Prisma.TransactionClient;

export type OwnershipAction = "delete" | "update" | "restore";

/**
 * enforceOwnership(user, record, action) — chính sách sở hữu NGHIÊM NGẶT.
 *
 * - Role đặc quyền (super_admin / admin / manager): bỏ qua kiểm tra.
 * - staff (và mọi role không đặc quyền):
 *     + Bắt buộc record phải có owner_id (một trong OWNER_FIELDS).
 *     + KHÔNG có fallback "cho phép nếu thiếu owner" → thiếu owner_id thì THROW.
 *     + owner_id phải trùng người đang thao tác, ngược lại THROW.
 */
export function enforceOwnership(ctx: LifecycleCtx, record: any, action: OwnershipAction): void {
  const privileged = !!ctx.role && ["super_admin", "admin", "manager"].includes(ctx.role);
  if (privileged) return;
  if (!ctx.actorUserId) {
    throw new LifecycleError("FORBIDDEN", `Thiếu thông tin người dùng để ${action}`);
  }
  if (!record || typeof record !== "object") {
    throw new LifecycleError("NO_OWNER", `Bản ghi không có owner_id — không cho phép ${action}`);
  }
  const ownerField = OWNER_FIELDS.find((f) => record[f] != null && String(record[f]).trim() !== "");
  if (!ownerField) {
    throw new LifecycleError("NO_OWNER", `Bản ghi không có owner_id — nhân viên không được phép ${action}`);
  }
  if (String(record[ownerField]) !== String(ctx.actorUserId)) {
    throw new LifecycleError("FORBIDDEN", `Nhân viên chỉ được ${action} dữ liệu của mình`);
  }
}

export class LifecycleService {
  constructor(private prisma: PrismaClient) {}

  // ---------- helpers ----------
  private async loadState(tx: Tx): Promise<any> {
    const row = await tx.appState.findUnique({ where: { id: 1 } });
    return (row?.data as any) ?? {};
  }
  private async saveState(tx: Tx, data: any) {
    await tx.appState.upsert({
      where: { id: 1 },
      create: { id: 1, data },
      update: { data },
    });
  }
  private arrayKey(entityType: string): string {
    const k = ENTITY_ARRAY_PATH[entityType];
    if (!k) throw new LifecycleError("UNKNOWN_ENTITY", `entity_type không hỗ trợ: ${entityType}`);
    return k;
  }
  private async getLifecycle(tx: Tx, t: string, id: string): Promise<any | null> {
    const rows = await tx.$queryRaw<any[]>(
      Prisma.sql`SELECT * FROM "entity_lifecycle" WHERE entity_type=${t} AND entity_id=${id} LIMIT 1`,
    );
    return rows[0] || null;
  }
  private assertTransition(from: LifecycleStatus, to: LifecycleStatus) {
    if (!TRANSITIONS[from]?.includes(to)) {
      throw new LifecycleError("ILLEGAL_TRANSITION", `Không thể chuyển ${from} → ${to}`);
    }
  }
  /** checkPermission(user, action) — ném lỗi nếu không đủ quyền. super_admin full quyền. */
  private assertPermission(ctx: LifecycleCtx, perm: string) {
    if (ctx.role === "super_admin") return;
    if (ctx.permissions?.includes(perm)) return;
    throw new LifecycleError("FORBIDDEN", `Bạn không có quyền: ${perm}`);
  }
  private assertAnyPermission(ctx: LifecycleCtx, perms: string[]) {
    if (ctx.role === "super_admin") return;
    if (ctx.permissions && perms.some((p) => ctx.permissions!.includes(p))) return;
    throw new LifecycleError("FORBIDDEN", `Bạn không có quyền: ${perms.join(" | ")}`);
  }
  private async writeVersion(
    tx: Tx,
    t: string,
    id: string,
    version: number,
    action: string,
    data: unknown,
    ctx: LifecycleCtx,
  ) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "record_versions" (id, company_id, entity_type, entity_id, version, action, data_json, actor_user_id, created_at)
      VALUES (${crypto.randomUUID()}, ${ctx.companyId ?? null}, ${t}, ${id}, ${version}, ${action},
              ${JSON.stringify(data ?? null)}, ${ctx.actorUserId ?? null}, ${new Date().toISOString()})`);
  }
  private async writeAudit(
    tx: Tx,
    action: string,
    t: string,
    id: string,
    before: unknown,
    after: unknown,
    ctx: LifecycleCtx,
  ) {
    await tx.auditLog.create({
      data: {
        companyId: ctx.companyId ?? null,
        actorUserId: ctx.actorUserId ?? null,
        action,
        resource: t,
        resourceId: id,
        before: before == null ? Prisma.DbNull : (before as Prisma.InputJsonValue),
        after: after == null ? Prisma.DbNull : (after as Prisma.InputJsonValue),
      },
    });
  }
  private addEntityTombstone(state: any, storeKey: string, entityId: string) {
    const tombstones =
      state.deletedEntityTombstones && typeof state.deletedEntityTombstones === "object"
        ? { ...state.deletedEntityTombstones }
        : {};
    const list = Array.isArray(tombstones[storeKey]) ? tombstones[storeKey].map(String) : [];
    const id = String(entityId);
    if (!list.includes(id)) tombstones[storeKey] = [...list, id];
    state.deletedEntityTombstones = tombstones;
  }

  private removeEntityTombstone(state: any, storeKey: string, entityId: string) {
    const tombstones =
      state.deletedEntityTombstones && typeof state.deletedEntityTombstones === "object"
        ? { ...state.deletedEntityTombstones }
        : {};
    const id = String(entityId);
    const list = Array.isArray(tombstones[storeKey]) ? tombstones[storeKey].map(String) : [];
    if (!list.length) return;
    tombstones[storeKey] = list.filter((x) => x !== id);
    if (!tombstones[storeKey]?.length) delete tombstones[storeKey];
    state.deletedEntityTombstones = tombstones;
  }

  private bumpVersionAfterStateMutation() {
    bumpStateDataVersion();
  }

  private emit(
    action: EntityLifecycleAction,
    t: string,
    id: string,
    version: number,
    status: LifecycleStatus,
    ctx: LifecycleCtx,
  ) {
    notifyEntityLifecycle({
      action,
      entityType: t,
      entityId: id,
      version,
      status,
      actorUserId: ctx.actorUserId ?? undefined,
      sourceClientId: ctx.sourceClientId,
      companyId: ctx.companyId ?? DEFAULT_STATE_ROOM_ID,
    });
  }

  // ---------- API ----------

  /** CREATE: thêm entity vào blob ACTIVE + version v1 + audit. */
  async createRecord(entityType: string, entity: { id: string } & Record<string, unknown>, ctx: LifecycleCtx) {
    if (!entity?.id) throw new LifecycleError("INVALID", "entity.id là bắt buộc");
    // Chính sách ownership: đảm bảo MỌI bản ghi mới đều có owner_id.
    const hasOwner = OWNER_FIELDS.some((f) => entity[f] != null && String(entity[f]).trim() !== "");
    if (!hasOwner && ctx.actorUserId) entity.owner_id = ctx.actorUserId;
    const result = await this.prisma.$transaction(async (tx) => {
      const key = this.arrayKey(entityType);
      const state = await this.loadState(tx);
      state[key] = Array.isArray(state[key]) ? state[key] : [];
      if (state[key].some((x: any) => String(x.id) === String(entity.id))) {
        throw new LifecycleError("DUPLICATE", `Đã tồn tại ${entityType}#${entity.id}`);
      }
      state[key].push(entity);
      await this.saveState(tx, state);
      await this.writeVersion(tx, entityType, entity.id, 1, "CREATE", entity, ctx);
      await this.writeAudit(tx, "CREATE", entityType, entity.id, null, entity, ctx);
      this.emit("DATA_CREATED", entityType, entity.id, 1, "ACTIVE", ctx);
      return { ok: true, version: 1, status: "ACTIVE" as LifecycleStatus };
    });
    this.bumpVersionAfterStateMutation();
    return result;
  }

  /** UPDATE: tăng version, snapshot bản mới, audit before/after. */
  async updateRecord(entityType: string, id: string, patch: Record<string, unknown>, ctx: LifecycleCtx) {
    const result = await this.prisma.$transaction(async (tx) => {
      const key = this.arrayKey(entityType);
      const state = await this.loadState(tx);
      const arr = Array.isArray(state[key]) ? state[key] : [];
      const idx = arr.findIndex((x: any) => String(x.id) === String(id));
      if (idx < 0) throw new LifecycleError("NOT_FOUND", `${entityType}#${id} không tồn tại/đang ACTIVE`);
      const before = arr[idx];
      enforceOwnership(ctx, before, "update");
      const after = { ...before, ...patch, id };
      arr[idx] = after;
      state[key] = arr;
      await this.saveState(tx, state);
      const lc = await this.getLifecycle(tx, entityType, id);
      const version = (lc?.version ?? 1) + 1;
      const now = new Date().toISOString();
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "entity_lifecycle" (id, company_id, entity_type, entity_id, status, version, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, ${ctx.companyId ?? null}, ${entityType}, ${id}, 'ACTIVE', ${version}, ${now}, ${now})
        ON CONFLICT(entity_type, entity_id) DO UPDATE SET version=${version}, status='ACTIVE', updated_at=${now}`);
      await this.writeVersion(tx, entityType, id, version, "UPDATE", after, ctx);
      await this.writeAudit(tx, "UPDATE", entityType, id, before, after, ctx);
      this.emit("DATA_UPDATED", entityType, id, version, "ACTIVE", ctx);
      return { ok: true, version, status: "ACTIVE" as LifecycleStatus };
    });
    this.bumpVersionAfterStateMutation();
    return result;
  }

  /** DELETE (soft): bê entity khỏi blob → entity_lifecycle SOFT_DELETED + snapshot. */
  async deleteRecord(entityType: string, id: string, ctx: LifecycleCtx) {
    this.assertPermission(ctx, DELETE_PERMISSIONS.soft);
    const result = await this.prisma.$transaction(async (tx) => {
      const key = this.arrayKey(entityType);
      const state = await this.loadState(tx);
      const arr = Array.isArray(state[key]) ? state[key] : [];
      const idx = arr.findIndex((x: any) => String(x.id) === String(id));
      if (idx < 0) throw new LifecycleError("NOT_FOUND", `${entityType}#${id} không ở ACTIVE`);
      const snapshot = arr[idx];
      enforceOwnership(ctx, snapshot, "delete");
      arr.splice(idx, 1);
      state[key] = arr;
      this.addEntityTombstone(state, key, id);
      if (entityType === "journalEntry") {
        removeJournalEntryIdFromAppState(state, id);
      } else {
        purgeJournalEntriesInAppState(state, entityType, id, snapshot as Record<string, unknown>);
      }
      await this.saveState(tx, state);

      const lc = await this.getLifecycle(tx, entityType, id);
      const version = (lc?.version ?? 1) + 1;
      const now = new Date().toISOString();
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "entity_lifecycle"
          (id, company_id, entity_type, entity_id, status, version, data_json, deleted_at, deleted_by, reason, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, ${ctx.companyId ?? null}, ${entityType}, ${id}, 'SOFT_DELETED', ${version},
                ${JSON.stringify(snapshot)}, ${now}, ${ctx.actorUserId ?? null}, ${ctx.reason ?? null}, ${now}, ${now})
        ON CONFLICT(entity_type, entity_id) DO UPDATE SET
          status='SOFT_DELETED', version=${version}, data_json=${JSON.stringify(snapshot)},
          deleted_at=${now}, deleted_by=${ctx.actorUserId ?? null}, reason=${ctx.reason ?? null},
          archived_at=NULL, purge_after=NULL, updated_at=${now}`);
      await this.writeVersion(tx, entityType, id, version, "SOFT_DELETE", snapshot, ctx);
      await this.writeAudit(tx, "SOFT_DELETE", entityType, id, snapshot, null, ctx);
      this.emit("DATA_SOFT_DELETED", entityType, id, version, "SOFT_DELETED", ctx);
      return { ok: true, version, status: "SOFT_DELETED" as LifecycleStatus };
    });
    this.bumpVersionAfterStateMutation();
    return result;
  }

  /** RESTORE: SOFT_DELETED/ARCHIVED/PENDING_DELETE → ACTIVE, trả entity về blob. */
  async restoreRecord(entityType: string, id: string, ctx: LifecycleCtx) {
    this.assertPermission(ctx, DELETE_PERMISSIONS.restore);
    const result = await this.prisma.$transaction(async (tx) => {
      const lc = await this.getLifecycle(tx, entityType, id);
      if (!lc) throw new LifecycleError("NOT_FOUND", `Không có bản lifecycle cho ${entityType}#${id}`);
      this.assertTransition(lc.status as LifecycleStatus, "ACTIVE");
      const snapshot = lc.data_json ? JSON.parse(lc.data_json) : null;
      if (!snapshot) throw new LifecycleError("NO_SNAPSHOT", "Thiếu snapshot để khôi phục");
      enforceOwnership(ctx, snapshot, "restore");
      const key = this.arrayKey(entityType);
      const state = await this.loadState(tx);
      state[key] = Array.isArray(state[key]) ? state[key] : [];
      if (!state[key].some((x: any) => String(x.id) === String(id))) state[key].push(snapshot);
      this.removeEntityTombstone(state, key, id);
      await this.saveState(tx, state);
      const version = (lc.version ?? 1) + 1;
      const now = new Date().toISOString();
      await tx.$executeRaw(Prisma.sql`
        UPDATE "entity_lifecycle" SET status='ACTIVE', version=${version},
          deleted_at=NULL, deleted_by=NULL, archived_at=NULL, purge_after=NULL,
          approved=0, requested_by=NULL, requested_at=NULL, approved_by=NULL, approved_at=NULL, updated_at=${now}
        WHERE entity_type=${entityType} AND entity_id=${id}`);
      await this.writeVersion(tx, entityType, id, version, "RESTORE", snapshot, ctx);
      await this.writeAudit(tx, "RESTORE", entityType, id, lc, snapshot, ctx);
      this.emit("DATA_RESTORED", entityType, id, version, "ACTIVE", ctx);
      return { ok: true, version, status: "ACTIVE" as LifecycleStatus };
    });
    this.bumpVersionAfterStateMutation();
    return result;
  }

  /** ARCHIVE: ACTIVE/SOFT_DELETED → ARCHIVED (chỉ đọc). */
  async archiveRecord(entityType: string, id: string, ctx: LifecycleCtx) {
    const result = await this.prisma.$transaction(async (tx) => {
      const lc = await this.getLifecycle(tx, entityType, id);
      const key = this.arrayKey(entityType);
      const state = await this.loadState(tx);
      const arr = Array.isArray(state[key]) ? state[key] : [];
      const idx = arr.findIndex((x: any) => String(x.id) === String(id));
      const fromStatus: LifecycleStatus = (lc?.status as LifecycleStatus) ?? (idx >= 0 ? "ACTIVE" : "SOFT_DELETED");
      this.assertTransition(fromStatus, "ARCHIVED");
      const snapshot = idx >= 0 ? arr[idx] : lc?.data_json ? JSON.parse(lc.data_json) : null;
      if (!snapshot) throw new LifecycleError("NO_SNAPSHOT", "Không tìm thấy dữ liệu để lưu trữ");
      if (idx >= 0) {
        arr.splice(idx, 1);
        state[key] = arr;
        this.addEntityTombstone(state, key, id);
        purgeJournalEntriesInAppState(state, entityType, id, snapshot as Record<string, unknown>);
        await this.saveState(tx, state);
      }
      const version = (lc?.version ?? 1) + 1;
      const now = new Date().toISOString();
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "entity_lifecycle"
          (id, company_id, entity_type, entity_id, status, version, data_json, archived_at, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, ${ctx.companyId ?? null}, ${entityType}, ${id}, 'ARCHIVED', ${version},
                ${JSON.stringify(snapshot)}, ${now}, ${now}, ${now})
        ON CONFLICT(entity_type, entity_id) DO UPDATE SET
          status='ARCHIVED', version=${version}, data_json=${JSON.stringify(snapshot)},
          archived_at=${now}, deleted_at=NULL, deleted_by=NULL, purge_after=NULL, updated_at=${now}`);
      await this.writeVersion(tx, entityType, id, version, "ARCHIVE", snapshot, ctx);
      await this.writeAudit(tx, "ARCHIVE", entityType, id, snapshot, { status: "ARCHIVED" }, ctx);
      this.emit("DATA_ARCHIVED", entityType, id, version, "ARCHIVED", ctx);
      return { ok: true, version, status: "ARCHIVED" as LifecycleStatus };
    });
    this.bumpVersionAfterStateMutation();
    return result;
  }

  /** Đánh dấu chờ xóa vĩnh viễn (Delete forever) → PENDING_DELETE + purge_after. */
  async markPendingDelete(entityType: string, id: string, graceDays: number, ctx: LifecycleCtx) {
    return this.prisma.$transaction(async (tx) => {
      const lc = await this.getLifecycle(tx, entityType, id);
      if (!lc) throw new LifecycleError("NOT_FOUND", "Không có bản lifecycle");
      this.assertTransition(lc.status as LifecycleStatus, "PENDING_DELETE");
      const purgeAfter = new Date(Date.now() + Math.max(0, graceDays) * 86400_000).toISOString();
      const now = new Date().toISOString();
      await tx.$executeRaw(Prisma.sql`
        UPDATE "entity_lifecycle" SET status='PENDING_DELETE', purge_after=${purgeAfter}, updated_at=${now}
        WHERE entity_type=${entityType} AND entity_id=${id}`);
      await this.writeAudit(tx, "PENDING_DELETE", entityType, id, lc, { purgeAfter }, ctx);
      this.emit("DATA_DELETED", entityType, id, lc.version ?? 1, "PENDING_DELETE", ctx);
      return { ok: true, version: lc.version ?? 1, status: "PENDING_DELETE" as LifecycleStatus, purgeAfter };
    });
  }

  /** PURGE: xóa thật khỏi DB. Chỉ từ PENDING_DELETE. Giữ vết version + audit (pháp lý). */
  async purgeRecord(entityType: string, id: string, ctx: LifecycleCtx) {
    return this.prisma.$transaction(async (tx) => {
      const lc = await this.getLifecycle(tx, entityType, id);
      if (!lc) throw new LifecycleError("NOT_FOUND", "Không có bản lifecycle");
      this.assertTransition(lc.status as LifecycleStatus, "DELETED");
      const snapshot = lc.data_json ? JSON.parse(lc.data_json) : null;
      const version = (lc.version ?? 1) + 1;
      await this.writeVersion(tx, entityType, id, version, "PURGE", snapshot, ctx);
      await this.writeAudit(tx, "PURGE", entityType, id, snapshot, null, ctx);
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM "entity_lifecycle" WHERE entity_type=${entityType} AND entity_id=${id}`);
      this.emit("DATA_PURGED", entityType, id, version, "DELETED", ctx);
      return { ok: true, version, status: "DELETED" as LifecycleStatus };
    });
  }

  // ========== Quy trình XÓA CÓ KIỂM SOÁT (request → approve → hard delete) ==========

  /** REQUEST hard delete (admin): SOFT_DELETED → PENDING_DELETE, approved=0. */
  async requestDelete(entityType: string, id: string, ctx: LifecycleCtx) {
    this.assertPermission(ctx, DELETE_PERMISSIONS.request);
    return this.prisma.$transaction(async (tx) => {
      const lc = await this.getLifecycle(tx, entityType, id);
      if (!lc)
        throw new LifecycleError(
          "NOT_FOUND",
          "Bản ghi phải nằm trong thùng rác (SOFT_DELETED) trước khi yêu cầu xóa vĩnh viễn",
        );
      this.assertTransition(lc.status as LifecycleStatus, "PENDING_DELETE");
      const now = new Date().toISOString();
      await tx.$executeRaw(Prisma.sql`
        UPDATE "entity_lifecycle" SET status='PENDING_DELETE', approved=0,
          requested_by=${ctx.actorUserId ?? null}, requested_at=${now},
          approved_by=NULL, approved_at=NULL, updated_at=${now}
        WHERE entity_type=${entityType} AND entity_id=${id}`);
      await this.writeAudit(tx, "REQUEST_DELETE", entityType, id, lc, { status: "PENDING_DELETE" }, ctx);
      this.emit("DATA_DELETE_REQUESTED", entityType, id, lc.version ?? 1, "PENDING_DELETE", ctx);
      return { ok: true, status: "PENDING_DELETE" as LifecycleStatus, approved: false };
    });
  }

  /** APPROVE hard delete (super admin / delete:approve): set approved=1, vẫn PENDING_DELETE. */
  async approveDelete(entityType: string, id: string, ctx: LifecycleCtx) {
    this.assertAnyPermission(ctx, [DELETE_PERMISSIONS.approve, DELETE_PERMISSIONS.hard]);
    return this.prisma.$transaction(async (tx) => {
      const lc = await this.getLifecycle(tx, entityType, id);
      if (!lc) throw new LifecycleError("NOT_FOUND", "Không có bản lifecycle");
      if (lc.status !== "PENDING_DELETE")
        throw new LifecycleError("ILLEGAL_TRANSITION", "Chỉ duyệt được bản ghi đang chờ xóa (PENDING_DELETE)");
      const now = new Date().toISOString();
      await tx.$executeRaw(Prisma.sql`
        UPDATE "entity_lifecycle" SET approved=1, approved_by=${ctx.actorUserId ?? null}, approved_at=${now}, updated_at=${now}
        WHERE entity_type=${entityType} AND entity_id=${id}`);
      await this.writeAudit(tx, "APPROVE_DELETE", entityType, id, lc, { approved: true }, ctx);
      this.emit("DATA_DELETE_APPROVED", entityType, id, lc.version ?? 1, "PENDING_DELETE", ctx);
      return { ok: true, status: "PENDING_DELETE" as LifecycleStatus, approved: true };
    });
  }

  /**
   * HARD DELETE (super admin / delete:hard): chỉ khi đã được duyệt (approved=1),
   * yêu cầu gõ đúng "DELETE", kiểm tra tham chiếu (FK), trì hoãn vài giây rồi mới DELETE thật.
   */
  async hardDelete(entityType: string, id: string, ctx: LifecycleCtx, opts: { confirmText?: string }) {
    this.assertPermission(ctx, DELETE_PERMISSIONS.hard);
    if ((opts?.confirmText ?? "") !== HARD_DELETE_CONFIRM_TEXT) {
      throw new LifecycleError("CONFIRM_REQUIRED", `Cần gõ "${HARD_DELETE_CONFIRM_TEXT}" để xác nhận xóa vĩnh viễn`);
    }
    const px = this.prisma as unknown as Tx;
    const pre = await this.getLifecycle(px, entityType, id);
    if (!pre) throw new LifecycleError("NOT_FOUND", "Không có bản lifecycle");
    if (pre.status !== "PENDING_DELETE")
      throw new LifecycleError("ILLEGAL_TRANSITION", "Chỉ xóa vĩnh viễn bản ghi đang chờ xóa (PENDING_DELETE)");
    if (!pre.approved) throw new LifecycleError("NOT_APPROVED", "Yêu cầu xóa chưa được super admin duyệt");

    // "Foreign key": không cho xóa nếu đang được tham chiếu.
    const state = await this.loadState(px);
    const guard = REFERENCE_GUARDS[entityType];
    const ref = guard ? guard(state, id) : null;
    if (ref) throw new LifecycleError("IN_USE", `Không thể xóa vĩnh viễn: ${ref}`);

    // Trì hoãn thực thi (cửa sổ an toàn để hủy).
    if (HARD_DELETE_DELAY_MS > 0) await new Promise((r) => setTimeout(r, HARD_DELETE_DELAY_MS));

    return this.prisma.$transaction(async (tx) => {
      const lc = await this.getLifecycle(tx, entityType, id);
      if (!lc) throw new LifecycleError("NOT_FOUND", "Bản ghi đã bị thay đổi/xóa");
      if (lc.status !== "PENDING_DELETE" || !lc.approved)
        throw new LifecycleError("ILLEGAL_TRANSITION", "Trạng thái đã thay đổi, hủy thao tác xóa");
      this.assertTransition(lc.status as LifecycleStatus, "DELETED");
      const snapshot = lc.data_json ? JSON.parse(lc.data_json) : null;
      const version = (lc.version ?? 1) + 1;
      await this.writeVersion(tx, entityType, id, version, "HARD_DELETE", snapshot, ctx);
      await this.writeAudit(tx, "HARD_DELETE", entityType, id, snapshot, null, ctx);
      await tx.$executeRaw(Prisma.sql`DELETE FROM "entity_lifecycle" WHERE entity_type=${entityType} AND entity_id=${id}`);
      this.emit("DATA_DELETED", entityType, id, version, "DELETED", ctx);
      return { ok: true, version, status: "DELETED" as LifecycleStatus };
    });
  }

  // ---------- Queries cho UI ----------
  listByStatus(status: LifecycleStatus, entityType?: string): Promise<any[]> {
    return entityType
      ? (this.prisma.$queryRaw(
          Prisma.sql`SELECT * FROM "entity_lifecycle" WHERE status=${status} AND entity_type=${entityType} ORDER BY updated_at DESC`,
        ) as Promise<any[]>)
      : (this.prisma.$queryRaw(
          Prisma.sql`SELECT * FROM "entity_lifecycle" WHERE status=${status} ORDER BY updated_at DESC`,
        ) as Promise<any[]>);
  }
  listVersions(entityType: string, id: string): Promise<any[]> {
    return this.prisma.$queryRaw(
      Prisma.sql`SELECT version, action, actor_user_id, created_at FROM "record_versions"
                 WHERE entity_type=${entityType} AND entity_id=${id} ORDER BY version DESC`,
    ) as Promise<any[]>;
  }
  getVersion(entityType: string, id: string, version: number): Promise<any[]> {
    return this.prisma.$queryRaw(
      Prisma.sql`SELECT * FROM "record_versions"
                 WHERE entity_type=${entityType} AND entity_id=${id} AND version=${version} LIMIT 1`,
    ) as Promise<any[]>;
  }
}
