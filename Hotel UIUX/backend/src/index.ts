import express from "express";
import multer from "multer";
import cors from "cors";
import { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import crypto from "node:crypto";
import http from "node:http";
import nodemailer from "nodemailer";
import { createClient } from "redis";
import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { WebSocket, WebSocketServer } from "ws";
// NOTE: Node ESM requires file extensions at runtime; TS will still resolve this to ./defaultState.ts in dev/build.
import { buildDefaultState } from "./defaultState.js";
import {
  applyCanonical64212AccountNames,
  buildDebtDetailsApiPayload,
  buildHydratedStateWithOpeningSql,
  buildOpeningBalancesApiPayload,
  ensureOpeningSqlBackfilled,
  persistDebtDetailsApiPayload,
  persistOpeningBalancesApiPayload,
  stripOpeningSqlState,
} from "./openingBalanceSql.js";
import { registerTaxGtgt01Routes } from "./taxGtgt01Routes.js";
import { registerNotificationRoutes } from "./notificationRoutes.js";
import { registerEInvoiceRoutes, startTaxXmlFileWatcher } from "./eInvoiceRoutes.js";
import { ensureLifecycleTables } from "./lifecycle/lifecycleSchema.js";
import { LifecycleService, LifecycleError } from "./lifecycle/lifecycleService.js";
import { startLifecycleJobs } from "./lifecycle/lifecycleJobs.js";
import {
  bumpStateDataVersion,
  getStateDataVersion,
  getStateRevision,
  notifyStateChanged,
  registerStateSyncRoutes,
  registerStateSyncWebSocket,
  type StateChangeKind,
} from "./stateSync.js";
import { configureRealtimeRedis } from "./realtime/index.js";
import { registerRealtimeRoutes } from "./realtime/routes.js";
import { realtimeBus } from "./realtime/redisEventBus.js";
import { diffHotelPmsBookingOutboxEvents } from "./outbox/hotelPmsDiff.js";
import { enqueueOutboxEvents } from "./outbox/outboxService.js";
import { startOutboxWorker, type OutboxWorker } from "./outbox/worker.js";
import { dbNow, isSqliteDatabase, isTimestampPast, insertIgnoreSql } from "./dbDialect.js";

// Repo blocks `.env*`, so we provide safe defaults in code.
process.env.DATABASE_URL ??=
  "postgresql://sme_hotel:sme_hotel_dev@localhost:5432/sme_hotel?schema=public";
process.env.PORT ??= "4000";
process.env.JWT_SECRET ??= "dev-secret-change-me";
process.env.JWT_EXPIRES_SECONDS ??= "604800"; // 7 days
process.env.OTP_TTL_SECONDS ??= "300"; // 5 minutes
process.env.REDIS_URL ??= "redis://redis:6379";
process.env.BACKUP_DIR ??= "/data/Backup";
process.env.BACKUP_HOST_PATH ??= ""; // optional: show a host path hint in UI
process.env.INVOICE_INCOMING_DIR ??= path.join(process.cwd(), "invoice-incoming");
process.env.INVOICE_INCOMING_HOST_PATH ??= "";

const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN ?? "http://127.0.0.1:3000";

const prisma = new PrismaClient();

const app = express();
const server = http.createServer(app);
const qrWss = new WebSocketServer({ noServer: true });
/** Phục hồi từ file .zip tải về máy (field `file`). */
const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!String(file.originalname || "").toLowerCase().endsWith(".zip")) {
      cb(new Error("Chỉ chấp nhận file .zip"));
      return;
    }
    cb(null, true);
  },
});
app.use(express.json({ limit: "50mb" }));
app.use(
  cors({
    origin: [
      FRONTEND_ORIGIN,
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:3180",
      "https://mphotel.asia",
      "https://www.mphotel.asia",
    ],
    credentials: false,
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

const PersistedStateSchema = z.record(z.string(), z.unknown());
const OpeningSqlByYearSchema = z.object({ byYearKey: z.record(z.string(), z.unknown()) });

// -------------------------
// User table (SQLite) via raw SQL
// Prisma client in this repo may be generated without the User delegate, so we use $queryRaw.
// -------------------------
type DbUser = {
  id: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  passwordHash: string;
  role: string;
  roleId: string | null;
  companyId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

type RbacPermissionName =
  | "create_user"
  | "reset_password"
  | "assign_role"
  | "create_data"
  | "update_data"
  | "delete_data"
  | "approve_data"
  // === Phân quyền xóa dạng action-based (RBAC delete lifecycle) ===
  | "delete:soft"
  | "delete:restore"
  | "delete:request"
  | "delete:approve"
  | "delete:hard"
  | "access_documents"
  | "access_dashboard"
  | "access_system"
  | "access_hotel_pms"
  | "access_devices"
  | "access_inventory"
  | "access_invoices"
  | "access_fund"
  | "access_cit"
  | "access_assets"
  | "access_accounting"
  | "access_reports"
  | "access_settings";

type AuthedUser = {
  id: string;
  role: string;
  roleId: string | null;
  companyId: string | null;
  status: "active" | "disabled";
  permissions: string[];
};

const DEFAULT_COMPANY_ID = "default-company";
const DEFAULT_COMPANY_SLUG = "default";
const RBAC_PERMISSIONS: RbacPermissionName[] = [
  "create_user",
  "reset_password",
  "assign_role",
  "create_data",
  "update_data",
  "delete_data",
  "approve_data",
  "delete:soft",
  "delete:restore",
  "delete:request",
  "delete:approve",
  "delete:hard",
  "access_documents",
  "access_dashboard",
  "access_system",
  "access_hotel_pms",
  "access_devices",
  "access_inventory",
  "access_invoices",
  "access_fund",
  "access_cit",
  "access_assets",
  "access_accounting",
  "access_reports",
  "access_settings",
];

// Hai quyền nguy hiểm nhất: chỉ super_admin được giữ (duyệt + xóa vĩnh viễn).
const HARD_DELETE_PERMISSIONS: RbacPermissionName[] = ["delete:approve", "delete:hard"];

const RBAC_DEFAULT_ROLES: Array<{
  name: "super_admin" | "admin" | "manager" | "staff";
  companyId: string | null;
  description: string;
  permissions: RbacPermissionName[];
}> = [
  {
    name: "super_admin",
    companyId: null,
    description: "Super admin - toàn quyền toàn hệ thống, không thuộc công ty",
    permissions: RBAC_PERMISSIONS,
  },
  {
    name: "admin",
    // Admin giữ mọi quyền CŨ + xóa mềm/khôi phục/yêu cầu xóa, NHƯNG không được
    // duyệt hoặc xóa vĩnh viễn (chỉ super_admin) — đảm bảo "không ai xóa vĩnh viễn vô tình".
    companyId: DEFAULT_COMPANY_ID,
    description: "Quản trị hệ thống - toàn quyền (trừ duyệt & xóa vĩnh viễn)",
    permissions: RBAC_PERMISSIONS.filter((p) => !HARD_DELETE_PERMISSIONS.includes(p)),
  },
  {
    name: "manager",
    companyId: DEFAULT_COMPANY_ID,
    description: "Quản lý - tạo, cập nhật và duyệt dữ liệu",
    permissions: [
      "create_data",
      "update_data",
      "approve_data",
      "access_dashboard",
      "delete:soft",
      "delete:restore",
    ],
  },
  {
    name: "staff",
    companyId: DEFAULT_COMPANY_ID,
    description: "Nhân viên - tạo dữ liệu và xóa mềm dữ liệu của mình",
    permissions: ["create_data", "access_dashboard", "delete:soft"],
  },
];

async function ensureUserTable() {
  // Use double-quotes for SQLite identifiers (User is sometimes reserved).
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "User" (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      phone TEXT UNIQUE,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      roleId TEXT,
      companyId TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      lastLoginAt TEXT
    );
  `);
  await ensureTableColumn("User", "username", "TEXT");
  await ensureTableColumn("User", "roleId", "TEXT");
  await ensureTableColumn("User", "companyId", "TEXT");
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User" ("username")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "User_roleId_idx" ON "User" ("roleId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "User_companyId_idx" ON "User" ("companyId")`);
}

async function ensureGtgt01DataTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Gtgt01Data" (
      "id" INTEGER NOT NULL PRIMARY KEY,
      "payload" JSONB NOT NULL,
      "updatedAt" DATETIME NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

async function ensureTableColumn(table: string, column: string, definition: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`);
  if (rows.some((r) => r.name === column)) return;
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
}

async function ensureRbacTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Company" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "slug" TEXT NOT NULL UNIQUE,
      "status" TEXT NOT NULL DEFAULT 'active',
      "createdAt" DATETIME NOT NULL DEFAULT (datetime('now')),
      "updatedAt" DATETIME NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Role" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "companyId" TEXT,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "isSystem" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT (datetime('now')),
      "updatedAt" DATETIME NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Permission" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "companyId" TEXT,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT (datetime('now')),
      "updatedAt" DATETIME NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "RolePermission" (
      "roleId" TEXT NOT NULL,
      "permissionId" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY ("roleId", "permissionId")
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AuditLog" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "companyId" TEXT,
      "actorUserId" TEXT,
      "action" TEXT NOT NULL,
      "resource" TEXT NOT NULL,
      "resourceId" TEXT,
      "before" JSONB,
      "after" JSONB,
      "ip" TEXT,
      "userAgent" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ApprovalRequest" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "companyId" TEXT,
      "resource" TEXT NOT NULL,
      "resourceId" TEXT,
      "payload" JSONB NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'PENDING_MANAGER',
      "requestedById" TEXT NOT NULL,
      "managerById" TEXT,
      "adminById" TEXT,
      "requestedAt" DATETIME NOT NULL DEFAULT (datetime('now')),
      "managerAt" DATETIME,
      "adminAt" DATETIME,
      "rejectionReason" TEXT
    )
  `);

  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Role_companyId_name_key" ON "Role" ("companyId", "name")`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Permission_companyId_name_key" ON "Permission" ("companyId", "name")`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Role_global_name_key" ON "Role" ("name") WHERE "companyId" IS NULL`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Permission_global_name_key" ON "Permission" ("name") WHERE "companyId" IS NULL`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "RolePermission_permissionId_idx" ON "RolePermission" ("permissionId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AuditLog_companyId_idx" ON "AuditLog" ("companyId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AuditLog_actorUserId_idx" ON "AuditLog" ("actorUserId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ApprovalRequest_companyId_idx" ON "ApprovalRequest" ("companyId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ApprovalRequest_status_idx" ON "ApprovalRequest" ("status")`);
}

async function ensureOtpQrTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Otp" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "target" TEXT NOT NULL,
      "targetType" TEXT NOT NULL,
      "purpose" TEXT NOT NULL,
      "codeHash" TEXT NOT NULL,
      "expiresAt" DATETIME NOT NULL,
      "verified" BOOLEAN NOT NULL DEFAULT false,
      "consumedAt" DATETIME,
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT (datetime('now')),
      "verifiedAt" DATETIME
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Otp_target_idx" ON "Otp" ("target")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Otp_target_purpose_idx" ON "Otp" ("target", "purpose")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Otp_createdAt_idx" ON "Otp" ("createdAt")`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "QrSession" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "userId" TEXT,
      "expiresAt" DATETIME NOT NULL,
      "consumedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT (datetime('now')),
      "confirmedAt" DATETIME
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "QrSession_status_idx" ON "QrSession" ("status")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "QrSession_expiresAt_idx" ON "QrSession" ("expiresAt")`);
}

async function dbFindUserById(id: string): Promise<DbUser | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? mapDbUser(user) : null;
}

async function dbFindUserByIdentifier(kind: "email" | "phone", value: string): Promise<DbUser | null> {
  const user =
    kind === "email"
      ? await prisma.user.findFirst({ where: { email: value.toLowerCase() } })
      : await prisma.user.findFirst({ where: { phone: value } });
  return user ? mapDbUser(user) : null;
}

function mapDbUser(user: {
  id: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  passwordHash: string;
  role: string;
  roleId: string | null;
  companyId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}): DbUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    passwordHash: user.passwordHash,
    role: user.role,
    roleId: user.roleId,
    companyId: user.companyId,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

async function dbCreateUser(input: {
  username?: string | null;
  email: string | null;
  phone: string | null;
  passwordHash: string;
  role: string;
  roleId?: string | null;
  companyId?: string | null;
  status: "active" | "disabled";
}): Promise<DbUser> {
  const id = crypto.randomUUID();
  const now = dbNow();
  const companyId = input.companyId === undefined ? DEFAULT_COMPANY_ID : input.companyId;
  await prisma.user.create({
    data: {
      id,
      username: input.username || null,
      email: input.email,
      phone: input.phone,
      passwordHash: input.passwordHash,
      role: input.role,
      roleId: input.roleId || null,
      companyId,
      status: input.status,
      createdAt: now,
      updatedAt: now,
    },
  });
  const created = await dbFindUserById(id);
  if (!created) throw new Error("Failed to create user");
  return created;
}

async function dbHasAnyUsers() {
  return (await prisma.user.count()) > 0;
}

async function dbUpdateLastLogin(userId: string) {
  const now = dbNow();
  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: now, updatedAt: now },
  });
}

async function dbUpdatePasswordHash(userId: string, passwordHash: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, updatedAt: dbNow() },
  });
}

type DbRole = {
  id: string;
  companyId: string | null;
  name: string;
  description: string | null;
  isSystem: number | boolean;
};

async function dbFindRoleByName(companyId: string | null, name: string): Promise<DbRole | null> {
  const role = await prisma.role.findFirst({
    where: companyId == null ? { name, companyId: null } : { name, companyId },
  });
  return role ? mapDbRole(role) : null;
}

async function dbFindRoleById(roleId: string): Promise<DbRole | null> {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  return role ? mapDbRole(role) : null;
}

function mapDbRole(role: {
  id: string;
  companyId: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
}): DbRole {
  return {
    id: role.id,
    companyId: role.companyId,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
  };
}

async function dbGetRolePermissions(roleId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`
    SELECT p.name
    FROM "RolePermission" rp
    JOIN "Permission" p ON p.id = rp."permissionId"
    WHERE rp."roleId" = ${roleId}
    ORDER BY p.name
  `);
  return rows.map((r) => r.name);
}

async function dbGetUserPermissions(user: DbUser): Promise<string[]> {
  let roleId = user.roleId || null;
  if (!roleId) {
    const legacyRoleName =
      user.role === "super_admin" ? "super_admin" : user.role === "admin" ? "admin" : user.role === "manager" ? "manager" : "staff";
    const roleCompanyId = legacyRoleName === "super_admin" ? null : user.companyId || DEFAULT_COMPANY_ID;
    const role = await dbFindRoleByName(roleCompanyId, legacyRoleName);
    roleId = role?.id || null;
  }
  return roleId ? dbGetRolePermissions(roleId) : [];
}

async function publicUserPayload(user: DbUser) {
  const roleName =
    user.roleId ? (await dbFindRoleById(user.roleId))?.name || user.role : user.role === "user" ? "staff" : user.role;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    role: roleName,
    roleId: user.roleId,
    companyId: roleName === "super_admin" ? null : user.companyId || DEFAULT_COMPANY_ID,
    permissions: await dbGetUserPermissions(user),
    status: user.status,
  };
}

async function dbWriteAuditLog(input: {
  actorUserId?: string | null;
  companyId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  req?: any;
}) {
  await prisma.auditLog.create({
    data: {
      id: crypto.randomUUID(),
      companyId: input.companyId || null,
      actorUserId: input.actorUserId || null,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId || null,
      before: input.before == null ? undefined : input.before,
      after: input.after == null ? undefined : input.after,
      ip: String(input.req?.ip || input.req?.headers?.["x-forwarded-for"] || "") || null,
      userAgent: String(input.req?.headers?.["user-agent"] || "") || null,
      createdAt: dbNow(),
    },
  });
}

function sanitizeAuditPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditPayload(item));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/password|otp|token|secret|authorization/i.test(key)) {
      out[key] = "***";
    } else {
      out[key] = sanitizeAuditPayload(item);
    }
  }
  return out;
}

async function seedRbacDefaults() {
  const now = dbNow();
  const companyCols = ["id", "name", "slug", "status", "createdAt", "updatedAt"];
  await prisma.$executeRaw(
    insertIgnoreSql(
      "Company",
      companyCols,
      ["id"],
      Prisma.sql`${DEFAULT_COMPANY_ID}, ${"Default Company"}, ${DEFAULT_COMPANY_SLUG}, ${"active"}, ${now}, ${now}`,
    ),
  );

  const permissionCols = ["id", "companyId", "name", "description", "createdAt", "updatedAt"];
  const permissionIds = new Map<string, string>();
  for (const permissionName of RBAC_PERMISSIONS) {
    const id = `perm_${permissionName}`;
    const globalId = `perm_global_${permissionName}`;
    permissionIds.set(`${DEFAULT_COMPANY_ID}:${permissionName}`, id);
    permissionIds.set(`global:${permissionName}`, globalId);
    await prisma.$executeRaw(
      insertIgnoreSql(
        "Permission",
        permissionCols,
        ["id"],
        Prisma.sql`${id}, ${DEFAULT_COMPANY_ID}, ${permissionName}, ${permissionName}, ${now}, ${now}`,
      ),
    );
    await prisma.$executeRaw(
      insertIgnoreSql(
        "Permission",
        permissionCols,
        ["id"],
        Prisma.sql`${globalId}, ${null}, ${permissionName}, ${permissionName}, ${now}, ${now}`,
      ),
    );
  }

  const roleCols = ["id", "companyId", "name", "description", "isSystem", "createdAt", "updatedAt"];
  const rolePermCols = ["roleId", "permissionId", "createdAt"];
  for (const role of RBAC_DEFAULT_ROLES) {
    const roleId = role.name === "super_admin" ? "role_super_admin" : `role_${role.name}`;
    await prisma.$executeRaw(
      insertIgnoreSql(
        "Role",
        roleCols,
        ["id"],
        Prisma.sql`${roleId}, ${role.companyId}, ${role.name}, ${role.description}, ${true}, ${now}, ${now}`,
      ),
    );
    for (const permissionName of role.permissions) {
      const permissionId = permissionIds.get(`${role.companyId || "global"}:${permissionName}`);
      if (!permissionId) continue;
      await prisma.$executeRaw(
        insertIgnoreSql(
          "RolePermission",
          rolePermCols,
          ["roleId", "permissionId"],
          Prisma.sql`${roleId}, ${permissionId}, ${now}`,
        ),
      );
    }
  }

  const companies = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM "Company"
  `);
  for (const company of companies.filter((c) => c.id !== DEFAULT_COMPANY_ID)) {
    for (const permissionName of RBAC_PERMISSIONS) {
      await prisma.$executeRaw(
        insertIgnoreSql(
          "Permission",
          permissionCols,
          ["id"],
          Prisma.sql`${`${company.id}_perm_${permissionName}`}, ${company.id}, ${permissionName}, ${permissionName}, ${now}, ${now}`,
        ),
      );
    }
    for (const role of RBAC_DEFAULT_ROLES.filter((r) => r.name !== "super_admin")) {
      const roleId = `${company.id}_role_${role.name}`;
      await prisma.$executeRaw(
        insertIgnoreSql(
          "Role",
          roleCols,
          ["id"],
          Prisma.sql`${roleId}, ${company.id}, ${role.name}, ${role.description}, ${true}, ${now}, ${now}`,
        ),
      );
      for (const permissionName of role.permissions) {
        await prisma.$executeRaw(
          insertIgnoreSql(
            "RolePermission",
            rolePermCols,
            ["roleId", "permissionId"],
            Prisma.sql`${roleId}, ${`${company.id}_perm_${permissionName}`}, ${now}`,
          ),
        );
      }
    }
  }

  // Migrate legacy role string -> dynamic RBAC roleId/companyId.
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "User"
    SET "companyId" = COALESCE("companyId", ${DEFAULT_COMPANY_ID}),
        "roleId" = COALESCE("roleId", CASE
          WHEN role = 'admin' THEN 'role_admin'
          WHEN role = 'manager' THEN 'role_manager'
          ELSE 'role_staff'
        END)
  `);
}

// -------------------------
// Backup / Restore (.zip) with weekly rotation
// Folder structure:
// Backup/
// ├── Weekly/   (auto-rotation)
// ├── Monthly/  (no auto delete)
// └── Yearly/   (no auto delete)
// -------------------------
type BackupTier = "Weekly" | "Monthly" | "Yearly";
type BackupTag = "FINAL" | "LOCKED" | "MANUAL" | "AUTO";
type BackupMeta = {
  tier: BackupTier;
  createdAt: string;
  createdBy?: string;
  tags: BackupTag[];
  filename: string;
  sizeBytes?: number;
};
type BackupSettings = {
  autoWeekly: boolean;
  maxWeeklyBackups: number; // 2/4/8
};

const PROTECTED_TAGS = new Set<BackupTag>(["FINAL", "LOCKED", "MANUAL"]);
const DEFAULT_BACKUP_SETTINGS: BackupSettings = { autoWeekly: false, maxWeeklyBackups: 4 };

const BACKUP_BASE = process.env.BACKUP_DIR || "/data/Backup";
const SETTINGS_PATH = path.join(BACKUP_BASE, "backup-settings.json");
const folderOf = (tier: BackupTier) => path.join(BACKUP_BASE, tier);

async function ensureBackupDirs() {
  await fs.mkdir(folderOf("Weekly"), { recursive: true });
  await fs.mkdir(folderOf("Monthly"), { recursive: true });
  await fs.mkdir(folderOf("Yearly"), { recursive: true });
}

async function loadBackupSettings(): Promise<BackupSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const max = Number(parsed?.maxWeeklyBackups || 4);
    const autoWeekly = Boolean(parsed?.autoWeekly);
    return { autoWeekly, maxWeeklyBackups: [2, 4, 8].includes(max) ? max : 4 };
  } catch {
    return DEFAULT_BACKUP_SETTINGS;
  }
}

async function saveBackupSettings(next: BackupSettings) {
  await ensureBackupDirs();
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(next, null, 2), "utf8");
}

function safeNamePart(s: string) {
  return String(s || "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function stampNow() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function listBackups(tier: BackupTier): Promise<BackupMeta[]> {
  await ensureBackupDirs();
  const dir = folderOf(tier);
  const files = await fs.readdir(dir).catch(() => []);
  const zips = files.filter((f) => f.toLowerCase().endsWith(".zip"));
  const metas: BackupMeta[] = [];
  for (const filename of zips) {
    const full = path.join(dir, filename);
    const metaPath = `${full}.meta.json`;
    let meta: BackupMeta | null = null;
    try {
      const raw = await fs.readFile(metaPath, "utf8");
      meta = JSON.parse(raw) as BackupMeta;
    } catch {
      // fallback
      meta = { tier, createdAt: new Date(0).toISOString(), tags: [], filename };
    }
    try {
      const st = await fs.stat(full);
      meta.sizeBytes = st.size;
      if (!meta.createdAt || meta.createdAt === new Date(0).toISOString()) {
        meta.createdAt = st.mtime.toISOString();
      }
    } catch {
      // ignore
    }
    metas.push({ ...meta, tier, filename });
  }
  metas.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return metas;
}

function isProtected(meta: BackupMeta) {
  if (meta.tier !== "Weekly") return true;
  return meta.tags.some((t) => PROTECTED_TAGS.has(t));
}

async function rotateWeekly(maxWeeklyBackups: number) {
  const all = await listBackups("Weekly");
  const candidates = all.filter((m) => !isProtected(m));
  if (candidates.length <= maxWeeklyBackups) return { cleaned: 0, deleted: [] as string[] };
  // oldest first
  const ordered = [...candidates].sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  const toDelete = ordered.slice(0, Math.max(0, ordered.length - maxWeeklyBackups));
  const deleted: string[] = [];
  for (const m of toDelete) {
    try {
      const full = path.join(folderOf("Weekly"), m.filename);
      await fs.unlink(full);
      await fs.unlink(`${full}.meta.json`).catch(() => undefined);
      console.log(`Đã xoá backup tuần ${m.filename}`);
      deleted.push(m.filename);
    } catch {
      // ignore
    }
  }
  return { cleaned: deleted.length, deleted };
}

async function createBackupZip(tier: BackupTier, tags: BackupTag[], createdBy?: string) {
  await ensureBackupDirs();
  // Read persisted state from DB
  const row = await getOrInitState();
  const state = row.data as any;
  const stateJson = JSON.stringify(state, null, 2);

  const filename = `${tier}_${stampNow()}__${safeNamePart(tags.join("-") || "AUTO")}.zip`;
  const meta: BackupMeta = {
    tier,
    createdAt: new Date().toISOString(),
    createdBy,
    tags,
    filename,
  };

  const dir = folderOf(tier);
  const full = path.join(dir, filename);

  const mod: any = await import("adm-zip");
  const AdmZip = mod?.default || mod;
  const zip = new AdmZip();
  // Always include state.json so the built-in restore flow can work.
  zip.addFile("state.json", Buffer.from(stateJson, "utf8"));
  zip.addFile("meta.json", Buffer.from(JSON.stringify(meta, null, 2), "utf8"));

  // Also include the underlying SQLite database file for transparency and disk-level recovery.
  // This avoids "zip looks empty" complaints when users expect a DB file, and helps debugging.
  try {
    const dbUrl = String(process.env.DATABASE_URL || "");
    if (dbUrl.startsWith("file:")) {
      const rawPath = dbUrl.slice("file:".length);
      const dbPath = rawPath.startsWith("//") ? rawPath.slice(2) : rawPath;
      if (dbPath) {
        const dbBuf = await fs.readFile(dbPath);
        zip.addFile("sqlite/dev.db", dbBuf);
      }
    }
  } catch {
    // ignore: state.json is still present
  }
  await fs.writeFile(full, zip.toBuffer());
  await fs.writeFile(`${full}.meta.json`, JSON.stringify(meta, null, 2), "utf8");
  const st = await fs.stat(full);
  meta.sizeBytes = st.size;
  return meta;
}

async function restoreAppStateFromZipBuffer(buf: Buffer) {
  const mod: any = await import("adm-zip");
  const AdmZip = mod?.default || mod;
  const zip = new AdmZip(buf);
  const entry = zip.getEntry("state.json");
  if (!entry) throw new Error("Trong .zip thiếu state.json (backup Victory chuẩn luôn có file này).");
  const stateRaw = zip.readAsText(entry);
  let json: unknown;
  try {
    json = JSON.parse(stateRaw);
  } catch {
    throw new Error("state.json trong .zip không phải JSON hợp lệ.");
  }
  const parsed = PersistedStateSchema.safeParse(json);
  if (!parsed.success) throw new Error("state.json không đúng định dạng state đã lưu.");
  await prisma.appState.upsert({
    where: { id: 1 },
    create: { id: 1, data: toPrismaJson(parsed.data) },
    update: { data: toPrismaJson(parsed.data) },
  });
}

async function restoreFromBackupZip(tier: BackupTier, filename: string) {
  await ensureBackupDirs();
  const full = path.join(folderOf(tier), path.basename(filename));
  const buf = await fs.readFile(full);
  await restoreAppStateFromZipBuffer(buf);
}

/** Sao chép file SQLite sang thư mục backup (cùng BACKUP_DIR/SqliteAuto) — bổ sung cho zip state.json. */
async function copySqliteToAutoBackupFolder() {
  const dbUrl = String(process.env.DATABASE_URL || "");
  if (!dbUrl.startsWith("file:")) return;
  const rawPath = dbUrl.slice("file:".length);
  const dbPath = rawPath.startsWith("//") ? rawPath.slice(2) : rawPath;
  if (!dbPath) return;
  try {
    await ensureBackupDirs();
    const destDir = path.join(BACKUP_BASE, "SqliteAuto");
    await fs.mkdir(destDir, { recursive: true });
    const dest = path.join(destDir, `victory_${stampNow()}.db`);
    await fs.copyFile(dbPath, dest);
    console.log(`[backup] SQLite auto copy -> ${dest}`);
  } catch (e) {
    console.warn("[backup] SQLite auto copy failed:", e);
  }
}

// -------------------------
// Auth + OTP (Redis) + JWT
// -------------------------

const EmailSchema = z.string().email();
const PhoneSchema = z
  .string()
  .regex(/^\+?[0-9]{9,15}$/, "Invalid phone number (use digits, optionally leading +)");

function normalizeIdentifier(input: string) {
  const raw = String(input || "").trim();
  const isEmail = EmailSchema.safeParse(raw).success;
  if (isEmail) return { kind: "email" as const, value: raw.toLowerCase() };
  const cleaned = raw.replace(/\s+/g, "");
  if (PhoneSchema.safeParse(cleaned).success) return { kind: "phone" as const, value: cleaned };
  return null;
}

function randomOtp6() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashOtp(target: string, purpose: string, code: string) {
  return crypto
    .createHmac("sha256", String(process.env.JWT_SECRET))
    .update(`${target}:${purpose}:${code}`)
    .digest("hex");
}

function base64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwt(payload: Record<string, unknown>) {
  const header = { alg: "HS256", typ: "JWT" };
  const encHeader = base64url(Buffer.from(JSON.stringify(header)));
  const encPayload = base64url(Buffer.from(JSON.stringify(payload)));
  const toSign = `${encHeader}.${encPayload}`;
  const sig = crypto.createHmac("sha256", String(process.env.JWT_SECRET)).update(toSign).digest();
  return `${toSign}.${base64url(sig)}`;
}

function verifyJwt(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const toSign = `${h}.${p}`;
  const expected = base64url(
    crypto.createHmac("sha256", String(process.env.JWT_SECRET)).update(toSign).digest()
  );
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(s))) return null;
  try {
    const payload = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    const exp = Number(payload?.exp || 0);
    if (exp && Math.floor(Date.now() / 1000) > exp) return null;
    return payload as any;
  } catch {
    return null;
  }
}

async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

async function hashPasswordLegacyScrypt(password: string) {
  const salt = crypto.randomBytes(16);
  const key = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derived) => (err ? reject(err) : resolve(derived as Buffer)));
  });
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string) {
  if (stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$")) {
    return bcrypt.compare(password, stored);
  }
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [algo, saltHex, keyHex] = parts;
  if (algo !== "scrypt") return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(keyHex, "hex");
  const actual = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, expected.length, (err, derived) =>
      err ? reject(err) : resolve(derived as Buffer)
    );
  });
  return crypto.timingSafeEqual(expected, actual);
}

type RedisClient = ReturnType<typeof createClient>;
let redis: RedisClient | null = null;
let redisDisabled = false;
type MemoryStoreEntry = {
  value: string;
  expiresAt: number;
};
const memoryStore = new Map<string, MemoryStoreEntry>();

function sweepMemoryStore(key?: string) {
  const now = Date.now();
  if (key) {
    const existing = memoryStore.get(key);
    if (existing && existing.expiresAt <= now) memoryStore.delete(key);
    return;
  }
  for (const [storeKey, entry] of memoryStore.entries()) {
    if (entry.expiresAt <= now) memoryStore.delete(storeKey);
  }
}

async function getRedis() {
  if (redis) return redis;
  if (redisDisabled) return null;
  try {
    const client = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 500,
        reconnectStrategy: false,
      },
    });
    client.on("error", (e) => console.warn("[redis] error", e));
    await client.connect();
    redis = client;
    console.log("[redis] connected");
    return redis;
  } catch (e) {
    redisDisabled = true;
    console.warn("[redis] unavailable, falling back to in-memory store.", e);
    redis = null;
    return null;
  }
}

async function configureRealtimeRedisPubSub() {
  const publisher = await getRedis();
  if (!publisher) {
    console.warn("[realtime] Redis unavailable — WebSocket single-instance mode.");
    await configureRealtimeRedis({ publisher: null, subscriber: null });
    return;
  }
  try {
    const subscriber = publisher.duplicate();
    subscriber.on("error", (e) => console.warn("[realtime] subscriber error", e));
    await subscriber.connect();
    await configureRealtimeRedis({
      publisher: publisher as import("redis").RedisClientType,
      subscriber: subscriber as import("redis").RedisClientType,
    });
  } catch (e) {
    console.warn("[realtime] Redis Pub/Sub unavailable — single-instance mode.", e);
    await configureRealtimeRedis({ publisher: null, subscriber: null });
  }
}

async function kvGet(key: string) {
  const client = await getRedis();
  if (client) return client.get(key);
  sweepMemoryStore(key);
  return memoryStore.get(key)?.value ?? null;
}

async function kvSetEx(key: string, ttlSeconds: number, value: string) {
  const client = await getRedis();
  if (client) {
    await client.setEx(key, ttlSeconds, value);
    return;
  }
  memoryStore.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

async function kvDel(key: string) {
  const client = await getRedis();
  if (client) {
    await client.del(key);
    return;
  }
  memoryStore.delete(key);
}

async function kvTtl(key: string) {
  const client = await getRedis();
  if (client) return client.ttl(key);
  sweepMemoryStore(key);
  const entry = memoryStore.get(key);
  if (!entry) return -2;
  return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
}

async function sendOtp(kind: "email" | "phone", to: string, otp: string) {
  // SMTP optional: if not configured, fallback to console.
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  if (kind === "email" && host && user && pass && from) {
    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || "false") === "true",
      auth: { user, pass },
    });
    await transporter.sendMail({
      from,
      to,
      subject: "Mã OTP đăng nhập/đăng ký",
      text: `Mã OTP của bạn là: ${otp}. Mã có hiệu lực trong ${process.env.OTP_TTL_SECONDS}s.`,
    });
    return;
  }
  if (kind === "phone" && process.env.SMS_WEBHOOK_URL) {
    const response = await fetch(process.env.SMS_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.SMS_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        to,
        message: `Ma OTP cua ban la ${otp}. Ma het han sau ${process.env.OTP_TTL_SECONDS}s.`,
      }),
    });
    if (!response.ok) throw new Error(`SMS provider failed: ${response.status}`);
    return;
  }
  // Dev fallback: email chưa cấu hình SMTP hoặc SMS chưa cấu hình provider.
  console.log(`[otp] ${kind}=${to} otp=${otp} ttl=${process.env.OTP_TTL_SECONDS}s`);
}

async function createOtpForTarget(input: {
  target: string;
  targetType: "email" | "phone";
  purpose: "register" | "login" | "reset";
}) {
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const countRows = await prisma.$queryRaw<Array<{ count: number | string }>>(Prisma.sql`
    SELECT COUNT(*) as count
    FROM "Otp"
    WHERE target = ${input.target} AND purpose = ${input.purpose} AND "createdAt" >= ${since}
  `);
  if (Number(countRows[0]?.count || 0) >= 5) {
    const err = new Error("Bạn đã gửi quá 5 OTP trong 10 phút. Vui lòng thử lại sau.");
    (err as any).status = 429;
    throw err;
  }

  const code = randomOtp6();
  const ttl = Number(process.env.OTP_TTL_SECONDS || 300);
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const id = crypto.randomUUID();
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Otp" (id, target, "targetType", purpose, "codeHash", "expiresAt", verified, attempts, "createdAt")
    VALUES (${id}, ${input.target}, ${input.targetType}, ${input.purpose}, ${hashOtp(input.target, input.purpose, code)}, ${expiresAt}, ${false}, ${0}, ${dbNow()})
  `);
  await sendOtp(input.targetType, input.target, code);
  return { id, code, ttlSeconds: ttl, expiresAt };
}

async function verifyOtpForTarget(input: {
  target: string;
  purpose: "register" | "login" | "reset";
  code: string;
  consume?: boolean;
}) {
  const now = dbNow();
  const rows = await prisma.$queryRaw<Array<{ id: string; codeHash: string; attempts: number | string; expiresAt: string; verified: number | boolean; consumedAt: string | null }>>(Prisma.sql`
    SELECT id, "codeHash", attempts, "expiresAt", verified, "consumedAt"
    FROM "Otp"
    WHERE target = ${input.target}
      AND purpose = ${input.purpose}
      AND "expiresAt" > ${now}
      AND "consumedAt" IS NULL
    ORDER BY "createdAt" DESC
    LIMIT 1
  `);
  const otp = rows[0];
  if (!otp) return { ok: false, reason: "OTP không tồn tại hoặc đã hết hạn." };
  if (Number(otp.attempts || 0) >= 5) return { ok: false, reason: "OTP đã bị khóa do nhập sai quá nhiều lần." };
  const expected = hashOtp(input.target, input.purpose, input.code);
  const ok =
    otp.codeHash.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(otp.codeHash), Buffer.from(expected));
  if (!ok) {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "Otp" SET attempts = attempts + 1 WHERE id = ${otp.id}
    `);
    return { ok: false, reason: "OTP không đúng." };
  }
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "Otp"
    SET verified = ${true},
        "verifiedAt" = COALESCE("verifiedAt", ${now}),
        "consumedAt" = CASE WHEN ${Boolean(input.consume)} THEN ${now} ELSE "consumedAt" END
    WHERE id = ${otp.id}
  `);
  return { ok: true, otpId: otp.id };
}

async function resolveAuthFromRequest(req: any): Promise<AuthedUser | null> {
  const header = String(req.headers.authorization || "");
  let urlToken = "";
  try {
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    urlToken = String(url.searchParams.get("token") || "").trim();
  } catch {}
  const queryToken = String(req.query?.token || urlToken || "").trim();
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : queryToken || null;
  if (!token) return null;
  const payload = verifyJwt(token);
  if (!payload?.sub) return null;

  if (payload?.jti) {
    const isBlacklisted = await kvGet(`bl:jti:${String(payload.jti)}`);
    if (isBlacklisted) return null;
  }

  const userId = String(payload.sub);
  const user = await dbFindUserById(userId);
  if (!user) return null;
  const status = (user.status || "active") as AuthedUser["status"];
  if (status !== "active") return null;
  const role =
    user.roleId ? (await dbFindRoleById(user.roleId))?.name || user.role || "staff" : user.role || "staff";
  const permissions = await dbGetUserPermissions(user);
  const companyId = role === "super_admin" ? null : user.companyId || DEFAULT_COMPANY_ID;
  return {
    id: user.id,
    role,
    roleId: user.roleId || null,
    companyId,
    status,
    permissions,
  } satisfies AuthedUser;
}

async function requireAuth(req: any, res: any, next: any) {
  const authed = await resolveAuthFromRequest(req);
  if (!authed) return res.status(401).json({ error: "Missing or invalid token" });
  req.user = authed;
  next();
}

const { readClientId } = registerStateSyncRoutes(app, {
  resolveAuth: async (req) => {
    const authed = await resolveAuthFromRequest(req);
    return authed
      ? { id: authed.id, companyId: authed.companyId, isSuperAdmin: authed.role === "super_admin" }
      : null;
  },
});

function resolveNotifyCompanyId(req?: any): string {
  const u = req?.user as AuthedUser | undefined;
  return u?.companyId || DEFAULT_COMPANY_ID;
}

function notifyScopeChanged(req: any, kinds: StateChangeKind[]) {
  notifyStateChanged({
    sourceClientId: readClientId(req),
    kinds,
    companyId: resolveNotifyCompanyId(req),
  });
}

const stateSyncWss = registerStateSyncWebSocket({
  resolveAuth: async (req) => {
    const authed = await resolveAuthFromRequest(req);
    return authed
      ? { id: authed.id, companyId: authed.companyId, isSuperAdmin: authed.role === "super_admin" }
      : null;
  },
});

function setStateRevisionHeader(res: any) {
  res.setHeader("X-State-Revision", String(getStateRevision()));
}

function setStateDataVersionHeader(res: any) {
  res.setHeader("X-State-Data-Version", String(getStateDataVersion()));
}

function checkPermission(permissionName: string) {
  return (req: any, res: any, next: any) => {
    const u: AuthedUser | undefined = req.user;
    if (!u) return res.status(401).json({ error: "Missing auth" });
    if (u.role === "super_admin") return next();
    if (!u.companyId) return res.status(403).json({ error: "Missing company scope" });
    if (!u.permissions.includes(permissionName)) {
      return res.status(403).json({ error: "Permission denied", permission: permissionName });
    }
    next();
  };
}

function checkAnyPermission(permissionNames: string[]) {
  return (req: any, res: any, next: any) => {
    const u: AuthedUser | undefined = req.user;
    if (!u) return res.status(401).json({ error: "Missing auth" });
    if (u.role === "super_admin") return next();
    if (!u.companyId) return res.status(403).json({ error: "Missing company scope" });
    if (permissionNames.some((p) => u.permissions.includes(p))) return next();
    return res.status(403).json({ error: "Permission denied", permission: permissionNames.join(" | ") });
  };
}

function resolveRbacCompanyId(u: AuthedUser, req: any): string | null {
  if (u.role === "super_admin") {
    const fromQuery = String(req.query?.companyId || "").trim();
    const fromBody = String(req.body?.companyId || "").trim();
    return fromQuery || fromBody || null;
  }
  return u.companyId || DEFAULT_COMPANY_ID;
}

function requireRbacCompanyId(u: AuthedUser, req: any, res: any): string | null {
  const companyId = resolveRbacCompanyId(u, req);
  if (!companyId) {
    res.status(400).json({ error: "companyId is required for super admin" });
    return null;
  }
  return companyId;
}

function checkUserManagement(req: any, res: any, next: any) {
  const u: AuthedUser | undefined = req.user;
  if (!u) return res.status(401).json({ error: "Missing auth" });
  if (u.role === "super_admin") return next();
  if (!u.companyId) return res.status(403).json({ error: "Missing company scope" });
  if (u.permissions.includes("create_user") || u.permissions.includes("assign_role")) return next();
  return res.status(403).json({ error: "Permission denied" });
}

function checkSuperAdmin(req: any, res: any, next: any) {
  const u: AuthedUser | undefined = req.user;
  if (!u) return res.status(401).json({ error: "Missing auth" });
  if (u.role !== "super_admin") return res.status(403).json({ error: "Super admin only" });
  next();
}

function requireAdmin(req: any, res: any, next: any) {
  const u: AuthedUser | undefined = req.user;
  if (!u) return res.status(401).json({ error: "Missing auth" });
  // Super admin luôn có toàn quyền (giống checkPermission), không phụ thuộc vào việc
  // role có được gán đúng permission "assign_role" hay không.
  if (u.role === "super_admin") return next();
  if (!u.permissions.includes("assign_role")) return res.status(403).json({ error: "Admin only" });
  next();
}

app.use(async (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const authed = await resolveAuthFromRequest(req).catch(() => null);
  if (!authed || authed.role !== "super_admin") return next();

  res.on("finish", () => {
    void dbWriteAuditLog({
      actorUserId: authed.id,
      companyId: null,
      action: `super_admin_${req.method.toLowerCase()}`,
      resource: "HttpRequest",
      resourceId: `${req.method} ${req.originalUrl || req.url}`,
      after: {
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        body: sanitizeAuditPayload(req.body),
      },
      req,
    }).catch((e) => console.warn("[audit] failed to log super_admin action:", e));
  });
  next();
});

// -------------------------
// QR OTP Login (Redis)
// Flow:
// - Desktop: POST /api/auth/qr/start -> shows QR + pairCode, polls status
// - Mobile/internal app (already logged in): POST /api/auth/qr/approve with pairCode/qrId
// - Desktop: POST /api/auth/qr/consume -> receives JWT
// -------------------------
type QrSessionStatus = "pending" | "approved";
type QrSession = {
  status: QrSessionStatus;
  createdAt: string;
  approvedAt?: string;
  approvedByUserId?: string;
};

const qrSockets = new Map<string, Set<WebSocket>>();

function makeSessionId() {
  return base64url(crypto.randomBytes(32));
}

function sendWsJson(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function notifyQrSession(sessionId: string, payload: unknown) {
  const clients = qrSockets.get(sessionId);
  if (!clients) return;
  for (const ws of clients) sendWsJson(ws, payload);
}

server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/ws/state") {
      stateSyncWss.handleUpgrade(req, socket, head, (ws) => {
        stateSyncWss.emit("connection", ws, req);
      });
      return;
    }
    if (url.pathname !== "/ws/qr") {
      socket.destroy();
      return;
    }
    qrWss.handleUpgrade(req, socket, head, (ws) => {
      qrWss.emit("connection", ws, req);
    });
  } catch {
    socket.destroy();
  }
});

qrWss.on("connection", async (ws, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
  const sessionId = String(url.searchParams.get("session_id") || url.searchParams.get("qrId") || "").trim();
  if (!sessionId) {
    sendWsJson(ws, { type: "error", error: "Missing session_id" });
    ws.close();
    return;
  }

  const rows = await prisma.$queryRaw<Array<{ id: string; status: string; expiresAt: string | Date; consumedAt: string | Date | null }>>(Prisma.sql`
    SELECT id, status, "expiresAt", "consumedAt"
    FROM "QrSession"
    WHERE id = ${sessionId}
    LIMIT 1
  `);
  const session = rows[0];
  if (!session || isTimestampPast(session.expiresAt) || session.consumedAt) {
    sendWsJson(ws, { type: "expired", session_id: sessionId });
    ws.close();
    return;
  }

  let clients = qrSockets.get(sessionId);
  if (!clients) {
    clients = new Set();
    qrSockets.set(sessionId, clients);
  }
  clients.add(ws);
  sendWsJson(ws, { type: "connected", session_id: sessionId, status: session.status });

  ws.on("close", () => {
    const set = qrSockets.get(sessionId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) qrSockets.delete(sessionId);
  });
});

function randomPairCode6() {
  return randomOtp6();
}

async function tryMakeQrDataUrl(text: string) {
  try {
    const mod: any = await import("qrcode");
    const QRCode = mod?.default || mod;
    const dataUrl = await QRCode.toDataURL(text, { errorCorrectionLevel: "M", margin: 2, width: 280 });
    return dataUrl as string;
  } catch (e) {
    console.warn("[qr] qrcode module unavailable:", e);
    return null;
  }
}

async function handleSendOtp(req: any, res: any) {
  const schema = z.object({ identifier: z.string(), purpose: z.enum(["register", "login", "reset"]) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const normalized = normalizeIdentifier(parsed.data.identifier);
  if (!normalized) return res.status(400).json({ error: "Invalid email/phone" });

  // For reset: don't reveal whether user exists. If user exists, proceed; otherwise return ok anyway.
  if (parsed.data.purpose === "reset") {
    const existing = await dbFindUserByIdentifier(normalized.kind, normalized.value);
    if (!existing) return res.json({ ok: true, ttlSeconds: Number(process.env.OTP_TTL_SECONDS || 300) });
  }

  try {
    const result = await createOtpForTarget({
      target: normalized.value,
      targetType: normalized.kind,
      purpose: parsed.data.purpose,
    });
    res.json({ ok: true, ttlSeconds: result.ttlSeconds });
  } catch (e: any) {
    res.status(Number(e?.status || 500)).json({ error: e?.message || "Send OTP failed" });
  }
}

app.post("/send-otp", handleSendOtp);
app.post("/api/auth/request-otp", handleSendOtp);

app.post("/verify-otp", async (req, res) => {
  const schema = z.object({
    identifier: z.string(),
    otp: z.string().regex(/^\d{6}$/),
    purpose: z.enum(["register", "login", "reset"]).default("register"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const normalized = normalizeIdentifier(parsed.data.identifier);
  if (!normalized) return res.status(400).json({ error: "Invalid email/phone" });
  const verified = await verifyOtpForTarget({
    target: normalized.value,
    purpose: parsed.data.purpose,
    code: parsed.data.otp,
    consume: false,
  });
  if (!verified.ok) return res.status(400).json({ error: verified.reason });
  res.json({ ok: true, verified: true });
});

async function handleCreateQrSession(_req: any, res: any) {
  const ttl = 120;
  const qrId = makeSessionId();
  const pairCode = randomPairCode6();
  const expiresAt = new Date(Date.now() + ttl * 1000);

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "QrSession" (id, status, "expiresAt", "createdAt")
    VALUES (${qrId}, ${"pending"}, ${expiresAt}, ${dbNow()})
  `);
  await kvSetEx(`qr:pair:${pairCode}`, ttl, qrId);

  // QR payload that internal app/camera can parse
  const qrText = JSON.stringify({ type: "VTR_LOGIN_QR", session_id: qrId, qrId, pairCode, expSeconds: ttl });
  const qrDataUrl = await tryMakeQrDataUrl(qrText);

  res.json({ session_id: qrId, qrId, pairCode, ttlSeconds: ttl, expiresAt, qrText, qrDataUrl });
}

app.post("/create-qr-session", handleCreateQrSession);
app.post("/api/auth/qr/start", handleCreateQrSession);

// Generate a 6-digit OTP via QR (for register/login OTP flows).
// This is NOT the "approve login" QR session; it simply produces an OTP stored hashed in DB.
app.post("/api/auth/qr/otp", async (req, res) => {
  const schema = z.object({
    identifier: z.string(),
    purpose: z.enum(["register", "login", "reset"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const normalized = normalizeIdentifier(parsed.data.identifier);
  if (!normalized) return res.status(400).json({ error: "Invalid email/phone" });

  if (parsed.data.purpose === "reset") {
    const existing = await dbFindUserByIdentifier(normalized.kind, normalized.value);
    if (!existing) return res.json({ ok: true, purpose: "reset", kind: normalized.kind, identifier: normalized.value, otp: "000000", ttlSeconds: Number(process.env.OTP_TTL_SECONDS || 300), qrText: "", qrDataUrl: null });
  }

  const result = await createOtpForTarget({
    target: normalized.value,
    targetType: normalized.kind,
    purpose: parsed.data.purpose,
  });

  const qrText = JSON.stringify({
    type: "VTR_OTP_QR",
    purpose: parsed.data.purpose,
    kind: normalized.kind,
    identifier: normalized.value,
    otp: result.code,
    expSeconds: result.ttlSeconds,
  });
  const qrDataUrl = await tryMakeQrDataUrl(qrText);

  res.json({
    ok: true,
    purpose: parsed.data.purpose,
    kind: normalized.kind,
    identifier: normalized.value,
    otp: result.code,
    ttlSeconds: result.ttlSeconds,
    qrText,
    qrDataUrl,
  });
});

app.get("/api/auth/qr/status", async (req, res) => {
  const qrId = String(req.query.qrId || "").trim();
  if (!qrId) return res.status(400).json({ error: "Missing qrId" });
  const rows = await prisma.$queryRaw<Array<{ id: string; status: string; userId: string | null; createdAt: string | Date; confirmedAt: string | Date | null; expiresAt: string | Date; consumedAt: string | Date | null }>>(Prisma.sql`
    SELECT id, status, "userId", "createdAt", "confirmedAt", "expiresAt", "consumedAt"
    FROM "QrSession"
    WHERE id = ${qrId}
    LIMIT 1
  `);
  const session = rows[0];
  if (!session || isTimestampPast(session.expiresAt)) return res.status(404).json({ error: "QR expired" });
  const publicStatus = session.status === "confirmed" ? "approved" : session.status;
  res.json({ qrId, session_id: qrId, status: publicStatus, createdAt: session.createdAt, approvedAt: session.confirmedAt });
});

async function handleScanQr(req: any, res: any) {
  const schema = z.object({
    qrId: z.string().optional(),
    session_id: z.string().optional(),
    pairCode: z.string().regex(/^\d{6}$/).optional(),
    user_id: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  let qrId = (parsed.data.qrId || parsed.data.session_id || "").trim();
  if (!qrId && parsed.data.pairCode) {
    const mapped = await kvGet(`qr:pair:${parsed.data.pairCode}`);
    if (!mapped) return res.status(404).json({ error: "Pair code expired" });
    qrId = mapped;
  }
  if (!qrId) return res.status(400).json({ error: "Missing qrId/pairCode" });

  const rows = await prisma.$queryRaw<Array<{ id: string; status: string; expiresAt: string | Date; consumedAt: string | Date | null }>>(Prisma.sql`
    SELECT id, status, "expiresAt", "consumedAt"
    FROM "QrSession"
    WHERE id = ${qrId}
    LIMIT 1
  `);
  const session = rows[0];
  if (!session || isTimestampPast(session.expiresAt)) return res.status(404).json({ error: "QR expired" });
  if (session.status !== "pending" || session.consumedAt) return res.status(409).json({ error: "QR already used" });

  const u: AuthedUser = req.user;
  const confirmedAt = dbNow();
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "QrSession"
    SET status = ${"confirmed"}, "userId" = ${u.id}, "confirmedAt" = ${confirmedAt}
    WHERE id = ${qrId}
  `);
  notifyQrSession(qrId, { type: "qr_confirmed", session_id: qrId, status: "confirmed" });
  res.json({ ok: true, qrId, session_id: qrId, status: "approved" });
}

app.post("/scan-qr", requireAuth, handleScanQr);
app.post("/api/auth/qr/approve", requireAuth, handleScanQr);

app.post("/api/auth/qr/consume", async (req, res) => {
  const schema = z.object({ qrId: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const qrId = parsed.data.qrId.trim();

  const rows = await prisma.$queryRaw<Array<{ id: string; status: string; userId: string | null; expiresAt: string | Date; consumedAt: string | Date | null }>>(Prisma.sql`
    SELECT id, status, "userId", "expiresAt", "consumedAt"
    FROM "QrSession"
    WHERE id = ${qrId}
    LIMIT 1
  `);
  const session = rows[0];
  if (!session || isTimestampPast(session.expiresAt)) return res.status(404).json({ error: "QR expired" });
  if (session.consumedAt) return res.status(409).json({ error: "QR already used" });
  if (session.status !== "confirmed" || !session.userId) {
    return res.status(409).json({ error: "Not approved yet" });
  }

  const user = await dbFindUserById(session.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.status !== "active") return res.status(403).json({ error: "User disabled" });

  // One-time use
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "QrSession"
    SET status = ${"consumed"}, "consumedAt" = ${dbNow()}
    WHERE id = ${qrId}
  `);

  const now = Math.floor(Date.now() / 1000);
  const exp = now + Number(process.env.JWT_EXPIRES_SECONDS || 604800);
  const token = signJwt({ sub: user.id, iat: now, exp, jti: crypto.randomUUID() });
  res.json({ token, user: await publicUserPayload(user) });
});

async function handleRegister(req: any, res: any) {
  const schema = z.object({
    identifier: z.string(),
    otp: z.string().regex(/^\d{6}$/),
    password: z.string().min(6),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const normalized = normalizeIdentifier(parsed.data.identifier);
  if (!normalized) return res.status(400).json({ error: "Invalid email/phone" });

  const verified = await verifyOtpForTarget({
    target: normalized.value,
    purpose: "register",
    code: parsed.data.otp,
    consume: true,
  });
  if (!verified.ok) return res.status(400).json({ error: verified.reason || "Invalid OTP" });

  const existing = await dbFindUserByIdentifier(normalized.kind, normalized.value);
  if (existing) return res.status(409).json({ error: "User already exists" });

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await dbCreateUser({
    email: normalized.kind === "email" ? normalized.value : null,
    phone: normalized.kind === "phone" ? normalized.value : null,
    passwordHash,
    role: "staff",
    roleId: (await dbFindRoleByName(DEFAULT_COMPANY_ID, "staff"))?.id || "role_staff",
    companyId: DEFAULT_COMPANY_ID,
    status: "active",
  });

  const now = Math.floor(Date.now() / 1000);
  const exp = now + Number(process.env.JWT_EXPIRES_SECONDS || 604800);
  const token = signJwt({ sub: user.id, iat: now, exp, jti: crypto.randomUUID() });
  res.json({ token, user: await publicUserPayload(user) });
}

app.post("/register", handleRegister);
app.post("/api/auth/register", handleRegister);

app.post("/api/auth/reset-password", async (req, res) => {
  const schema = z.object({
    identifier: z.string(),
    otp: z.string().regex(/^\d{6}$/),
    newPassword: z.string().min(6),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const normalized = normalizeIdentifier(parsed.data.identifier);
  if (!normalized) return res.status(400).json({ error: "Invalid email/phone" });

  const user = await dbFindUserByIdentifier(normalized.kind, normalized.value);
  // Keep response generic
  if (!user) {
    return res.json({ ok: true });
  }
  if (user.status !== "active") return res.status(403).json({ error: "User disabled" });

  const verified = await verifyOtpForTarget({
    target: normalized.value,
    purpose: "reset",
    code: parsed.data.otp,
    consume: true,
  });
  if (!verified.ok) return res.status(400).json({ error: verified.reason || "Invalid OTP" });

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await dbUpdatePasswordHash(user.id, passwordHash);
  res.json({ ok: true });
});

app.post("/api/auth/login/password", async (req, res) => {
  const schema = z.object({ identifier: z.string(), password: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const normalized = normalizeIdentifier(parsed.data.identifier);
  if (!normalized) return res.status(400).json({ error: "Invalid email/phone" });
  const user = await dbFindUserByIdentifier(normalized.kind, normalized.value);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  if (user.status !== "active") return res.status(403).json({ error: "User disabled" });
  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });
  await dbUpdateLastLogin(user.id);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Number(process.env.JWT_EXPIRES_SECONDS || 604800);
  const token = signJwt({ sub: user.id, iat: now, exp, jti: crypto.randomUUID() });
  res.json({ token, user: await publicUserPayload(user) });
});

// -------------------------
// Backup endpoints
// -------------------------
// Create/list/download: mọi user đăng nhập. Restore: mọi user đăng nhập (single-tenant); cài đặt xoay backup vẫn mở cho mọi user.
app.get("/api/backup/info", requireAuth, async (_req, res) => {
  await ensureBackupDirs();
  const settings = await loadBackupSettings();
  res.json({
    baseDir: BACKUP_BASE,
    hostPathHint: process.env.BACKUP_HOST_PATH || "",
    folders: {
      Weekly: folderOf("Weekly"),
      Monthly: folderOf("Monthly"),
      Yearly: folderOf("Yearly"),
    },
    settings,
    retentionOptionsWeeks: [2, 4, 8],
  });
});

app.put("/api/backup/settings", requireAuth, async (req, res) => {
  const schema = z.object({
    autoWeekly: z.boolean().optional(),
    maxWeeklyBackups: z.number().int().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const current = await loadBackupSettings();
  const max = parsed.data.maxWeeklyBackups ?? current.maxWeeklyBackups;
  const next: BackupSettings = {
    autoWeekly: parsed.data.autoWeekly ?? current.autoWeekly,
    maxWeeklyBackups: [2, 4, 8].includes(max) ? max : current.maxWeeklyBackups,
  };
  await saveBackupSettings(next);
  res.json({ ok: true, settings: next });
});

app.get("/api/backup/list", requireAuth, async (_req, res) => {
  const weekly = await listBackups("Weekly");
  const monthly = await listBackups("Monthly");
  const yearly = await listBackups("Yearly");
  res.json({ Weekly: weekly, Monthly: monthly, Yearly: yearly });
});

app.post("/api/backup/create", requireAuth, async (req: any, res) => {
  const schema = z.object({
    tier: z.enum(["Weekly", "Monthly", "Yearly"]),
    tags: z.array(z.enum(["FINAL", "LOCKED", "MANUAL", "AUTO"])).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const tier = parsed.data.tier as BackupTier;
  const tags = (parsed.data.tags && parsed.data.tags.length > 0 ? parsed.data.tags : ["AUTO"]) as BackupTag[];
  const u: AuthedUser = req.user;
  const meta = await createBackupZip(tier, tags, u.id);

  let cleanup: any = { cleaned: 0, deleted: [] as string[] };
  if (tier === "Weekly") {
    const settings = await loadBackupSettings();
    cleanup = await rotateWeekly(settings.maxWeeklyBackups);
  }
  res.json({ ok: true, backup: meta, cleanup });
});

app.get("/api/backup/download", requireAuth, async (req, res) => {
  const tier = String(req.query.tier || "");
  const filename = String(req.query.filename || "");
  if (!["Weekly", "Monthly", "Yearly"].includes(tier)) return res.status(400).json({ error: "Invalid tier" });
  if (!filename.endsWith(".zip")) return res.status(400).json({ error: "Invalid filename" });
  const full = path.join(folderOf(tier as BackupTier), path.basename(filename));
  try {
    const buf = await fs.readFile(full);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filename)}"`);
    res.send(buf);
  } catch {
    res.status(404).json({ error: "Not found" });
  }
});

app.post("/api/backup/restore", requireAuth, async (req, res) => {
  const schema = z.object({
    tier: z.enum(["Weekly", "Monthly", "Yearly"]),
    filename: z.string(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const tier = parsed.data.tier as BackupTier;
  const filename = path.basename(parsed.data.filename);
  if (!filename.endsWith(".zip")) return res.status(400).json({ error: "Invalid filename" });
  try {
    await restoreFromBackupZip(tier, filename);
    bumpStateDataVersion();
    notifyScopeChanged(req, ["restore", "state"]);
    setStateRevisionHeader(res);
    setStateDataVersionHeader(res);
    res.json({ ok: true, revision: getStateRevision() });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || "Restore failed" });
  }
});

/** Phục hồi từ file .zip trên máy (đã tải về), multipart field `file`. */
app.post(
  "/api/backup/restore-upload",
  requireAuth,
  (req, res, next) => {
    backupUpload.single("file")(req, res, (err: unknown) => {
      if (err) {
        const msg = err instanceof Error ? err.message : "Upload thất bại";
        return res.status(400).json({ error: msg });
      }
      next();
    });
  },
  async (req: any, res) => {
    try {
      const buf = req.file?.buffer as Buffer | undefined;
      if (!buf?.length) return res.status(400).json({ error: "Thiếu file .zip (tên field: file)." });
      await restoreAppStateFromZipBuffer(buf);
      bumpStateDataVersion();
      notifyScopeChanged(req, ["restore", "state"]);
      setStateRevisionHeader(res);
      setStateDataVersionHeader(res);
      res.json({ ok: true, revision: getStateRevision() });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Restore failed" });
    }
  }
);

app.post("/api/auth/login/otp", async (req, res) => {
  const schema = z.object({ identifier: z.string(), otp: z.string().regex(/^\d{6}$/) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const normalized = normalizeIdentifier(parsed.data.identifier);
  if (!normalized) return res.status(400).json({ error: "Invalid email/phone" });
  const verified = await verifyOtpForTarget({
    target: normalized.value,
    purpose: "login",
    code: parsed.data.otp,
    consume: true,
  });
  if (!verified.ok) return res.status(400).json({ error: verified.reason || "Invalid OTP" });

  const user = await dbFindUserByIdentifier(normalized.kind, normalized.value);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.status !== "active") return res.status(403).json({ error: "User disabled" });
  await dbUpdateLastLogin(user.id);

  const now = Math.floor(Date.now() / 1000);
  const exp = now + Number(process.env.JWT_EXPIRES_SECONDS || 604800);
  const token = signJwt({ sub: user.id, iat: now, exp, jti: crypto.randomUUID() });
  res.json({ token, user: await publicUserPayload(user) });
});

app.post("/api/auth/logout", async (req, res) => {
  // Stateless JWT: client should delete token. Optional blacklist (requires Redis).
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token ? verifyJwt(token) : null;
  if (payload?.jti && payload?.exp) {
    const ttl = Math.max(1, Number(payload.exp) - Math.floor(Date.now() / 1000));
    await kvSetEx(`bl:jti:${payload.jti}`, ttl, "1");
  }
  res.json({ ok: true });
});

app.post("/api/auth/change-password", requireAuth, async (req: any, res) => {
  const schema = z.object({
    oldPassword: z.string().min(1),
    newPassword: z.string().min(6),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const u: AuthedUser = req.user;
  const user = await dbFindUserById(u.id);
  if (!user) return res.status(401).json({ error: "User not found" });
  if (user.status !== "active") return res.status(403).json({ error: "User disabled" });

  const ok = await verifyPassword(parsed.data.oldPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Mật khẩu cũ không đúng" });

  const nextHash = await hashPassword(parsed.data.newPassword);
  await dbUpdatePasswordHash(user.id, nextHash);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, async (req: any, res) => {
  const u: AuthedUser = req.user;
  const user = await dbFindUserById(u.id);
  if (!user) return res.status(401).json({ error: "User not found" });
  res.json(await publicUserPayload(user));
});

app.post("/api/audit/client", requireAuth, async (req: any, res) => {
  const schema = z.object({
    action: z.string().min(1).max(120),
    resource: z.string().min(1).max(120),
    resourceId: z.string().max(160).optional(),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const u: AuthedUser = req.user;
  await dbWriteAuditLog({
    actorUserId: u.id,
    companyId: u.companyId,
    action: parsed.data.action,
    resource: parsed.data.resource,
    resourceId: parsed.data.resourceId || null,
    before: sanitizeAuditPayload(parsed.data.before),
    after: sanitizeAuditPayload(parsed.data.after),
    req,
  });
  res.json({ ok: true });
});

// -------------------------
// RBAC dynamic admin APIs
// -------------------------
app.get("/api/super-admin/audit-logs", requireAuth, checkSuperAdmin, async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    companyId: string | null;
    actorUserId: string | null;
    action: string;
    resource: string;
    resourceId: string | null;
    before: string | null;
    after: string | null;
    ip: string | null;
    userAgent: string | null;
    createdAt: string;
  }>>(Prisma.sql`
    SELECT id, "companyId", "actorUserId", action, resource, "resourceId", before, after, ip, "userAgent", "createdAt"
    FROM "AuditLog"
    ORDER BY "createdAt" DESC
    LIMIT ${limit}
  `);
  res.json({ auditLogs: rows });
});

app.get("/api/super-admin/companies", requireAuth, checkSuperAdmin, async (_req, res) => {
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; slug: string; status: string; createdAt: string; updatedAt: string }>>(Prisma.sql`
    SELECT id, name, slug, status, "createdAt", "updatedAt"
    FROM "Company"
    ORDER BY "createdAt" DESC
  `);
  res.json({ companies: rows });
});

app.post("/api/super-admin/companies", requireAuth, checkSuperAdmin, async (req, res) => {
  const schema = z.object({
    name: z.string().min(2).max(120),
    slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const id = crypto.randomUUID();
  const now = dbNow();
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Company" (id, name, slug, status, "createdAt", "updatedAt")
    VALUES (${id}, ${parsed.data.name}, ${parsed.data.slug}, ${"active"}, ${now}, ${now})
  `);

  const permissionCols = ["id", "companyId", "name", "description", "createdAt", "updatedAt"];
  const roleCols = ["id", "companyId", "name", "description", "isSystem", "createdAt", "updatedAt"];
  const rolePermCols = ["roleId", "permissionId", "createdAt"];

  for (const permissionName of RBAC_PERMISSIONS) {
    const permissionId = `${id}_perm_${permissionName}`;
    await prisma.$executeRaw(
      insertIgnoreSql(
        "Permission",
        permissionCols,
        ["id"],
        Prisma.sql`${permissionId}, ${id}, ${permissionName}, ${permissionName}, ${now}, ${now}`,
      ),
    );
  }
  for (const role of RBAC_DEFAULT_ROLES.filter((r) => r.name !== "super_admin")) {
    const roleId = `${id}_role_${role.name}`;
    await prisma.$executeRaw(
      insertIgnoreSql(
        "Role",
        roleCols,
        ["id"],
        Prisma.sql`${roleId}, ${id}, ${role.name}, ${role.description}, ${true}, ${now}, ${now}`,
      ),
    );
    for (const permissionName of role.permissions) {
      await prisma.$executeRaw(
        insertIgnoreSql(
          "RolePermission",
          rolePermCols,
          ["roleId", "permissionId"],
          Prisma.sql`${roleId}, ${`${id}_perm_${permissionName}`}, ${now}`,
        ),
      );
    }
  }

  notifyScopeChanged(req, ["rbac"]);
  res.status(201).json({ company: { id, ...parsed.data, status: "active" } });
});

app.post("/api/super-admin/companies/:companyId/admins", requireAuth, checkSuperAdmin, async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    username: z.string().min(2).max(64).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const companyRows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM "Company" WHERE id = ${req.params.companyId} LIMIT 1
  `);
  const company = companyRows[0];
  if (!company) return res.status(404).json({ error: "Company not found" });

  const existing = await dbFindUserByIdentifier("email", parsed.data.email);
  if (existing) return res.status(409).json({ error: "User already exists" });

  const adminRole = await dbFindRoleByName(company.id, "admin");
  if (!adminRole) return res.status(500).json({ error: "Company admin role not initialized" });

  const user = await dbCreateUser({
    username: parsed.data.username || null,
    email: parsed.data.email.toLowerCase(),
    phone: null,
    passwordHash: await hashPassword(parsed.data.password),
    role: "admin",
    roleId: adminRole.id,
    companyId: company.id,
    status: "active",
  });
  notifyScopeChanged(req, ["rbac"]);
  res.status(201).json({ user: await publicUserPayload(user) });
});

app.get("/api/rbac/users", requireAuth, checkUserManagement, async (req: any, res) => {
  const u: AuthedUser = req.user;
  const companyId = requireRbacCompanyId(u, req, res);
  if (!companyId) return;
  const rows = await prisma.$queryRaw<DbUser[]>(Prisma.sql`
    SELECT id, username, email, phone, "passwordHash", role, "roleId", "companyId", status, "createdAt", "updatedAt", "lastLoginAt"
    FROM "User"
    WHERE "companyId" = ${companyId} AND role != 'super_admin'
    ORDER BY "createdAt" DESC
  `);
  const users = await Promise.all(rows.map((row) => publicUserPayload(row)));
  res.json({ users });
});

app.get("/api/rbac/permissions", requireAuth, checkUserManagement, async (req: any, res) => {
  const u: AuthedUser = req.user;
  const companyId = requireRbacCompanyId(u, req, res);
  if (!companyId) return;
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; description: string | null }>>(Prisma.sql`
    SELECT id, name, description
    FROM "Permission"
    WHERE "companyId" = ${companyId}
    ORDER BY name
  `);
  res.json({ permissions: rows });
});

app.get("/api/rbac/roles", requireAuth, checkUserManagement, async (req: any, res) => {
  const u: AuthedUser = req.user;
  const companyId = requireRbacCompanyId(u, req, res);
  if (!companyId) return;
  const roles = await prisma.$queryRaw<Array<{ id: string; name: string; description: string | null; isSystem: number | boolean }>>(Prisma.sql`
    SELECT id, name, description, "isSystem"
    FROM "Role"
    WHERE "companyId" = ${companyId}
    ORDER BY name
  `);
  const out = [];
  for (const role of roles) {
    out.push({ ...role, permissions: await dbGetRolePermissions(role.id) });
  }
  res.json({ roles: out });
});

app.post("/api/rbac/roles", requireAuth, checkPermission("assign_role"), async (req: any, res) => {
  const schema = z.object({
    name: z.string().min(2).max(64).regex(/^[a-zA-Z0-9_.-]+$/),
    description: z.string().max(255).optional(),
    permissions: z.array(z.string()).optional(),
    companyId: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const u: AuthedUser = req.user;
  const companyId = requireRbacCompanyId(u, req, res);
  if (!companyId) return;
  const id = crypto.randomUUID();
  const now = dbNow();
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Role" (id, "companyId", name, description, "isSystem", "createdAt", "updatedAt")
    VALUES (${id}, ${companyId}, ${parsed.data.name}, ${parsed.data.description || null}, ${false}, ${now}, ${now})
  `);
  if (parsed.data.permissions?.length) {
    const permissions = await prisma.$queryRaw<Array<{ id: string; name: string }>>(Prisma.sql`
      SELECT id, name FROM "Permission"
      WHERE "companyId" = ${companyId}
    `);
    const byName = new Map(permissions.map((p) => [p.name, p.id]));
    for (const permissionName of parsed.data.permissions) {
      const permissionId = byName.get(permissionName);
      if (!permissionId) continue;
      await prisma.$executeRaw(
        insertIgnoreSql(
          "RolePermission",
          ["roleId", "permissionId", "createdAt"],
          ["roleId", "permissionId"],
          Prisma.sql`${id}, ${permissionId}, ${now}`,
        ),
      );
    }
  }
  await dbWriteAuditLog({
    actorUserId: u.id,
    companyId: companyId,
    action: "create_role",
    resource: "Role",
    resourceId: id,
    after: parsed.data,
    req,
  });
  notifyScopeChanged(req, ["rbac"]);
  res.status(201).json({ id, ...parsed.data });
});

app.put("/api/rbac/roles/:roleId/permissions", requireAuth, checkPermission("assign_role"), async (req: any, res) => {
  const schema = z.object({
    permissions: z.array(z.string()),
    companyId: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const u: AuthedUser = req.user;
  const companyId = requireRbacCompanyId(u, req, res);
  if (!companyId) return;
  const role = await dbFindRoleById(req.params.roleId);
  if (!role || role.companyId !== companyId) return res.status(404).json({ error: "Role not found" });
  const before = await dbGetRolePermissions(role.id);
  const permissions = await prisma.$queryRaw<Array<{ id: string; name: string }>>(Prisma.sql`
    SELECT id, name FROM "Permission"
    WHERE "companyId" = ${companyId}
  `);
  const byName = new Map(permissions.map((p) => [p.name, p.id]));
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "RolePermission" WHERE "roleId" = ${role.id}`);
  for (const permissionName of parsed.data.permissions) {
    const permissionId = byName.get(permissionName);
    if (!permissionId) continue;
    await prisma.$executeRaw(
      insertIgnoreSql(
        "RolePermission",
        ["roleId", "permissionId", "createdAt"],
        ["roleId", "permissionId"],
        Prisma.sql`${role.id}, ${permissionId}, ${dbNow()}`,
      ),
    );
  }
  await dbWriteAuditLog({
    actorUserId: u.id,
    companyId: companyId,
    action: "update_role_permissions",
    resource: "Role",
    resourceId: role.id,
    before,
    after: parsed.data.permissions,
    req,
  });
  notifyScopeChanged(req, ["rbac"]);
  res.json({ ok: true, roleId: role.id, permissions: await dbGetRolePermissions(role.id) });
});

app.post("/api/rbac/users", requireAuth, checkPermission("create_user"), async (req: any, res) => {
  const schema = z.object({
    username: z.string().min(2).max(64),
    password: z.string().min(6),
    roleId: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    companyId: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const u: AuthedUser = req.user;
  const companyId = requireRbacCompanyId(u, req, res);
  if (!companyId) return;
  const role = parsed.data.roleId
    ? await dbFindRoleById(parsed.data.roleId)
    : await dbFindRoleByName(companyId, "staff");
  if (!role || role.companyId !== companyId) return res.status(400).json({ error: "Invalid role" });
  const passwordHash = await hashPassword(parsed.data.password);
  const created = await dbCreateUser({
    username: parsed.data.username,
    email: parsed.data.email || null,
    phone: parsed.data.phone || null,
    passwordHash,
    role: role.name,
    roleId: role.id,
    companyId: companyId,
    status: "active",
  });
  await dbWriteAuditLog({
    actorUserId: u.id,
    companyId: companyId,
    action: "create_user",
    resource: "User",
    resourceId: created.id,
    after: { ...parsed.data, password: "***" },
    req,
  });
  notifyScopeChanged(req, ["rbac"]);
  res.status(201).json({ user: await publicUserPayload(created) });
});

app.patch("/api/rbac/users/:userId/role", requireAuth, checkPermission("assign_role"), async (req: any, res) => {
  const schema = z.object({
    roleId: z.string(),
    companyId: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const u: AuthedUser = req.user;
  const companyId = requireRbacCompanyId(u, req, res);
  if (!companyId) return;
  const target = await dbFindUserById(req.params.userId);
  const role = await dbFindRoleById(parsed.data.roleId);
  if (!target || target.companyId !== companyId) return res.status(404).json({ error: "User not found" });
  if (!role || role.companyId !== companyId) return res.status(400).json({ error: "Invalid role" });
  const before = await publicUserPayload(target);
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "User"
    SET "roleId" = ${role.id}, role = ${role.name}, "updatedAt" = ${dbNow()}
    WHERE id = ${target.id}
  `);
  const updated = await dbFindUserById(target.id);
  await dbWriteAuditLog({
    actorUserId: u.id,
    companyId: companyId,
    action: "assign_role",
    resource: "User",
    resourceId: target.id,
    before,
    after: updated ? await publicUserPayload(updated) : null,
    req,
  });
  notifyScopeChanged(req, ["rbac"]);
  res.json({ user: updated ? await publicUserPayload(updated) : null });
});

app.post("/api/rbac/users/:userId/reset-password", requireAuth, checkPermission("reset_password"), async (req: any, res) => {
  const schema = z.object({
    newPassword: z.string().min(6),
    companyId: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const u: AuthedUser = req.user;
  const companyId = requireRbacCompanyId(u, req, res);
  if (!companyId) return;
  const target = await dbFindUserById(req.params.userId);
  if (!target || target.companyId !== companyId) return res.status(404).json({ error: "User not found" });
  await dbUpdatePasswordHash(target.id, await hashPassword(parsed.data.newPassword));
  await dbWriteAuditLog({
    actorUserId: u.id,
    companyId: companyId,
    action: "reset_password",
    resource: "User",
    resourceId: target.id,
    req,
  });
  notifyScopeChanged(req, ["rbac"]);
  res.json({ ok: true });
});

// Ví dụ đúng yêu cầu: app.post("/create", checkPermission("create_data"), handler)
app.post("/api/rbac/example/create", requireAuth, checkPermission("create_data"), async (req: any, res) => {
  const u: AuthedUser = req.user;
  await dbWriteAuditLog({
    actorUserId: u.id,
    companyId: u.companyId,
    action: "create_data",
    resource: "ExampleData",
    after: req.body,
    req,
  });
  res.json({ ok: true, ownerUserId: u.id, companyId: u.companyId });
});

app.post("/api/approvals", requireAuth, checkPermission("create_data"), async (req: any, res) => {
  const schema = z.object({
    resource: z.string().min(1),
    resourceId: z.string().optional(),
    payload: z.record(z.string(), z.unknown()),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const u: AuthedUser = req.user;
  const id = crypto.randomUUID();
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "ApprovalRequest" (id, "companyId", resource, "resourceId", payload, status, "requestedById", "requestedAt")
    VALUES (${id}, ${u.companyId}, ${parsed.data.resource}, ${parsed.data.resourceId || null}, ${JSON.stringify(parsed.data.payload)}, ${"PENDING_MANAGER"}, ${u.id}, ${dbNow()})
  `);
  await dbWriteAuditLog({
    actorUserId: u.id,
    companyId: u.companyId,
    action: "request_approval",
    resource: parsed.data.resource,
    resourceId: parsed.data.resourceId || id,
    after: parsed.data.payload,
    req,
  });
  res.status(201).json({ id, status: "PENDING_MANAGER" });
});

app.post("/api/approvals/:id/approve", requireAuth, checkPermission("approve_data"), async (req: any, res) => {
  const u: AuthedUser = req.user;
  const rows = await prisma.$queryRaw<Array<{ id: string; status: string; companyId: string | null }>>(Prisma.sql`
    SELECT id, status, "companyId" FROM "ApprovalRequest" WHERE id = ${req.params.id} LIMIT 1
  `);
  const approval = rows[0];
  if (!approval || approval.companyId !== u.companyId) return res.status(404).json({ error: "Approval not found" });
  const isAdminConfirm = u.permissions.includes("assign_role");
  const nextStatus = isAdminConfirm ? "APPROVED" : "PENDING_ADMIN";
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "ApprovalRequest"
    SET status = ${nextStatus},
        "managerById" = COALESCE("managerById", ${u.id}),
        "managerAt" = COALESCE("managerAt", ${dbNow()}),
        "adminById" = CASE WHEN ${isAdminConfirm} THEN ${u.id} ELSE "adminById" END,
        "adminAt" = CASE WHEN ${isAdminConfirm} THEN ${dbNow()} ELSE "adminAt" END
    WHERE id = ${approval.id}
  `);
  await dbWriteAuditLog({
    actorUserId: u.id,
    companyId: u.companyId,
    action: isAdminConfirm ? "admin_confirm_approval" : "manager_approve",
    resource: "ApprovalRequest",
    resourceId: approval.id,
    before: approval.status,
    after: nextStatus,
    req,
  });
  res.json({ id: approval.id, status: nextStatus });
});

// Optional: bootstrap an admin user for first-time setup (Docker-friendly).
async function bootstrapAdmin() {
  const envIdentifier = process.env.BOOTSTRAP_ADMIN_IDENTIFIER;
  const hasEnvPassword = Object.prototype.hasOwnProperty.call(process.env, "BOOTSTRAP_ADMIN_PASSWORD");
  let identifier = envIdentifier;
  let password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";

  if (!identifier || !hasEnvPassword) {
    if (process.env.NODE_ENV === "production") return;
    const hasUsers = await dbHasAnyUsers();
    if (hasUsers) return;
    identifier = "admin@victory.local";
    password = "";
  }

  const normalized = normalizeIdentifier(identifier);
  if (!normalized) return;
  const existing = await dbFindUserByIdentifier(normalized.kind, normalized.value);
  if (existing) return;
  const passwordHash = await hashPassword(password);
  await dbCreateUser({
    email: normalized.kind === "email" ? normalized.value : null,
    phone: normalized.kind === "phone" ? normalized.value : null,
    passwordHash,
    role: "admin",
    roleId: (await dbFindRoleByName(DEFAULT_COMPANY_ID, "admin"))?.id || "role_admin",
    companyId: DEFAULT_COMPANY_ID,
    status: "active",
  });
  console.log(
    `[auth] bootstrapped admin: ${normalized.kind} ${normalized.value}${password ? "" : " (empty password)"}`
  );
}

async function bootstrapSuperAdmin() {
  const identifier = process.env.SUPER_ADMIN_EMAIL || process.env.SUPER_ADMIN_IDENTIFIER;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!identifier || password == null) return;

  const normalized = normalizeIdentifier(identifier);
  if (!normalized || normalized.kind !== "email") {
    console.warn("[auth] SUPER_ADMIN_EMAIL must be a valid email address.");
    return;
  }

  const role = await dbFindRoleByName(null, "super_admin");
  if (!role) throw new Error("super_admin role is not initialized");

  const existing = await dbFindUserByIdentifier("email", normalized.value);

  // Khôi phục khi QUÊN mật khẩu super admin: đặt SUPER_ADMIN_RESET=1 (kèm SUPER_ADMIN_EMAIL
  // và SUPER_ADMIN_PASSWORD) rồi khởi động lại backend. Khi đó mật khẩu sẽ được đặt lại,
  // đồng thời bảo đảm tài khoản ở trạng thái active và đúng quyền super_admin.
  const forceReset = /^(1|true|yes|on)$/i.test(String(process.env.SUPER_ADMIN_RESET || "").trim());

  if (existing) {
    // Mặc định KHÔNG ghi đè tài khoản đã tồn tại (an toàn). Chỉ đặt lại khi bật cờ.
    if (!forceReset) return;
    const now = dbNow();
    const passwordHash = await hashPassword(password);
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "User"
      SET "passwordHash" = ${passwordHash},
          role = 'super_admin',
          "roleId" = ${role.id},
          "companyId" = NULL,
          status = 'active',
          "updatedAt" = ${now}
      WHERE id = ${existing.id}
    `);
    await dbWriteAuditLog({
      actorUserId: existing.id,
      companyId: null,
      action: "reset_super_admin_password",
      resource: "User",
      resourceId: existing.id,
      after: { email: normalized.value, role: "super_admin", via: "SUPER_ADMIN_RESET" },
    });
    console.log(`[auth] super_admin password reset via SUPER_ADMIN_RESET: ${normalized.value}`);
    return;
  }

  const user = await dbCreateUser({
    email: normalized.value,
    phone: null,
    passwordHash: await hashPassword(password),
    role: "super_admin",
    roleId: role.id,
    companyId: null,
    status: "active",
  });
  await dbWriteAuditLog({
    actorUserId: user.id,
    companyId: null,
    action: "bootstrap_super_admin",
    resource: "User",
    resourceId: user.id,
    after: { email: normalized.value, role: "super_admin" },
  });
  console.log(`[auth] bootstrapped super_admin: ${normalized.value}`);
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  // Ensure it's JSON-serializable; Prisma Json column cannot store functions/undefined/etc.
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function cloneJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function entityArrayKeyOf(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const raw = (item as Record<string, unknown>).id;
  const id = raw == null ? "" : String(raw).trim();
  return id || null;
}

function mergeTombstoneMaps(serverValue: unknown, incomingValue: unknown): Record<string, string[]> {
  const server = cloneJsonObject(serverValue);
  const incoming = cloneJsonObject(incomingValue);
  const fields = new Set([...Object.keys(server), ...Object.keys(incoming)]);
  const out: Record<string, string[]> = {};
  for (const field of fields) {
    const ids = new Set<string>();
    for (const id of Array.isArray(server[field]) ? (server[field] as string[]) : []) ids.add(String(id));
    for (const id of Array.isArray(incoming[field]) ? (incoming[field] as string[]) : []) ids.add(String(id));
    if (ids.size > 0) out[field] = [...ids];
  }
  return out;
}

function tombstoneIdSet(map: Record<string, string[]>, field: string): Set<string> {
  return new Set((map[field] || []).map(String));
}

function mergeEntityDeletionAuditLog(serverValue: unknown, incomingValue: unknown): unknown[] {
  const combined = [
    ...(Array.isArray(serverValue) ? serverValue : []),
    ...(Array.isArray(incomingValue) ? incomingValue : []),
  ];
  const byKey = new Map<string, Record<string, unknown>>();
  for (const entry of combined) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const entityType = String(row.entityType || "");
    const entityId = String(row.entityId || "");
    if (!entityType || !entityId) continue;
    const key = `${entityType}:${entityId}`;
    const prev = byKey.get(key);
    const at = String(row.deletedAt || "");
    const prevAt = String(prev?.deletedAt || "");
    if (!prev || at >= prevAt) byKey.set(key, row);
  }
  return [...byKey.values()].slice(-500);
}

function mergeEntityArrays(
  serverValue: unknown,
  incomingValue: unknown,
  deletedIds?: Set<string>,
): unknown[] {
  const serverItems = Array.isArray(serverValue) ? serverValue : [];
  const incomingItems = Array.isArray(incomingValue) ? incomingValue : [];
  const deleted = deletedIds || new Set<string>();
  const byKey = new Map<string, unknown>();
  const withoutKey: unknown[] = [];

  for (const item of serverItems) {
    const key = entityArrayKeyOf(item);
    if (key && deleted.has(key)) continue;
    if (key) {
      byKey.set(key, item);
    } else {
      withoutKey.push(item);
    }
  }

  // Conflict merge: incoming wins for the same id, but server-only rows are preserved.
  // Tombstoned ids are never restored — even if a stale client still has the row locally.
  for (const item of incomingItems) {
    const key = entityArrayKeyOf(item);
    if (key && deleted.has(key)) continue;
    if (key) {
      byKey.set(key, item);
    } else {
      withoutKey.push(item);
    }
  }

  return [...byKey.values(), ...withoutKey];
}

const MERGE_ARRAY_FIELDS = new Set([
  "accountingPeriods",
  "devices",
  "invoices",
  "inventory",
  "journalEntries",
  "transactions",
  "fundTransactions",
  "assets",
  "accountingVouchers",
  "productionOrders",
  "accounts",
  "customers",
  "suppliers",
  "employees",
  "warehouses",
  "expenseCategories",
  "taxRates",
  "paymentMethods",
  "bankAccounts",
  "citLossRecords",
  "inventoryCatalog",
  "bomDefinitions",
  "financialYears",
]);

const YEAR_DATA_ARRAY_FIELDS = new Set([
  "accountingPeriods",
  "invoices",
  "inventory",
  "journalEntries",
  "transactions",
  "fundTransactions",
  "accountingVouchers",
  "productionOrders",
  "citLossRecords",
]);

function mergeYearDataByKey(
  serverValue: unknown,
  incomingValue: unknown,
  tombstones: Record<string, string[]>,
): Record<string, unknown> {
  const serverMap = cloneJsonObject(serverValue);
  const incomingMap = cloneJsonObject(incomingValue);
  const out: Record<string, unknown> = { ...serverMap };
  const yearKeys = new Set([...Object.keys(serverMap), ...Object.keys(incomingMap)]);

  for (const yearKey of yearKeys) {
    const serverYear = cloneJsonObject(serverMap[yearKey]);
    const incomingYear = cloneJsonObject(incomingMap[yearKey]);
    const mergedYear: Record<string, unknown> = { ...serverYear, ...incomingYear };
    for (const field of YEAR_DATA_ARRAY_FIELDS) {
      if (field in serverYear || field in incomingYear) {
        const deleted = tombstoneIdSet(tombstones, field);
        mergedYear[field] = mergeEntityArrays(serverYear[field], incomingYear[field], deleted);
      }
    }
    out[yearKey] = mergedYear;
  }

  return out;
}

function mergePersistedStateOnConflict(serverState: unknown, incomingState: unknown): Record<string, unknown> {
  const server = cloneJsonObject(serverState);
  const incoming = cloneJsonObject(incomingState);
  const tombstones = mergeTombstoneMaps(server.deletedEntityTombstones, incoming.deletedEntityTombstones);
  const merged: Record<string, unknown> = { ...server, ...incoming };
  merged.deletedEntityTombstones = tombstones;
  merged.entityDeletionAuditLog = mergeEntityDeletionAuditLog(
    server.entityDeletionAuditLog,
    incoming.entityDeletionAuditLog,
  );

  for (const field of MERGE_ARRAY_FIELDS) {
    if (field in server || field in incoming) {
      const deleted = tombstoneIdSet(tombstones, field);
      merged[field] = mergeEntityArrays(server[field], incoming[field], deleted);
    }
  }

  merged.yearDataByKey = mergeYearDataByKey(server.yearDataByKey, incoming.yearDataByKey, tombstones);
  return merged;
}

async function getOrInitState() {
  const existing = await prisma.appState.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.appState.create({ data: { id: 1, data: toPrismaJson(buildDefaultState()) } });
}

/** Một lần / idempotent: cập nhật tên 6421·6422 trong JSON lưu DB cho khớp chuẩn TT133. */
async function persistCanonical64212AccountLabelsIfNeeded() {
  const row = await prisma.appState.findUnique({ where: { id: 1 } });
  if (!row?.data) return;
  const data = JSON.parse(JSON.stringify(row.data)) as Record<string, unknown>;
  if (!applyCanonical64212AccountNames(data)) return;
  await prisma.appState.update({
    where: { id: 1 },
    data: { data: toPrismaJson(stripOpeningSqlState(data)) },
  });
}

app.get("/api/state", async (_req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    await persistCanonical64212AccountLabelsIfNeeded();
    const row = await getOrInitState();
    const backfilled = await ensureOpeningSqlBackfilled(prisma, row.data, toPrismaJson);
    const baseState = backfilled ? (await getOrInitState()).data : row.data;
    setStateDataVersionHeader(res);
    res.json(await buildHydratedStateWithOpeningSql(prisma, baseState));
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error("[GET /api/state] Failed to load state:", message);
    res.status(500).json({ error: "Failed to load state", details: process.env.NODE_ENV === "development" ? message : undefined });
  }
});

app.put("/api/state", requireAuth, async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const parsed = PersistedStateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid state payload" });
    }

    // Optimistic concurrency: client gửi phiên bản dữ liệu đang giữ.
    // Nếu lệch (máy khác đã ghi sau lần client này đọc), backend sẽ hợp nhất
    // các danh sách theo id thay vì ghi đè toàn bộ snapshot hoặc trả 409 làm
    // frontend tải lại và mất phần vừa nhập.
    const expectedRaw = String(req.headers["x-expected-state-version"] || "").trim();
    const expected = expectedRaw ? Number(expectedRaw) : null;
    // Sau RESET, client gửi X-Force-Replace=1 để ghi đè toàn bộ, bỏ qua hợp nhất theo id
    // (nếu union-merge sẽ giữ lại bản ghi chỉ-có-ở-server → "phục hồi" dữ liệu vừa xóa).
    const forceReplace = String(req.headers["x-force-replace"] || "").trim() === "1";

    // Chống "phục hồi sau RESET": mỗi lần reset/khởi tạo, state mang một stateResetMarker mới.
    // Nếu một client (tab/máy khác) vẫn giữ dữ liệu cũ và cố ghi đè với marker cũ hơn marker
    // hiện tại của server → từ chối (409) buộc client tải lại trạng thái trống, thay vì để
    // cơ chế hợp nhất theo id "khôi phục" lại toàn bộ dữ liệu vừa xóa.
    if (!forceReplace) {
      const current = await getOrInitState();
      const serverMarker = (current.data as any)?.stateResetMarker;
      const incomingMarker = (parsed.data as any)?.stateResetMarker;
      if (serverMarker != null && incomingMarker !== serverMarker) {
        setStateDataVersionHeader(res);
        res.setHeader("X-State-Reset-Mismatch", "1");
        return res.status(409).json({ error: "State was reset; reload required." });
      }
    }

    const hasConflict =
      !forceReplace &&
      expected != null && Number.isFinite(expected) && expected !== getStateDataVersion();

    let strippedState = stripOpeningSqlState(parsed.data);
    const stateBeforeSave = await getOrInitState();
    if (hasConflict) {
      strippedState = mergePersistedStateOnConflict(stateBeforeSave.data, strippedState);
      // Giữ nguyên marker của server (không để incoming hạ cấp).
      (strippedState as any).stateResetMarker = (stateBeforeSave.data as any)?.stateResetMarker;
      res.setHeader("X-State-Merged-Conflict", "1");
    }

    const prevHotelPms = (stateBeforeSave.data as Record<string, unknown>)?.hotelPms;
    const nextHotelPms = (strippedState as Record<string, unknown>).hotelPms;
    const notifyCompanyId = resolveNotifyCompanyId(req);
    const sourceClientId = readClientId(req);
    const bookingOutboxEvents = diffHotelPmsBookingOutboxEvents(
      prevHotelPms,
      nextHotelPms,
      notifyCompanyId,
      sourceClientId,
    );

    let outboxEnqueued = 0;
    await prisma.$transaction(async (tx) => {
      await tx.appState.upsert({
        where: { id: 1 },
        create: { id: 1, data: toPrismaJson(strippedState) },
        update: { data: toPrismaJson(strippedState) },
      });
      outboxEnqueued = await enqueueOutboxEvents(tx, bookingOutboxEvents);
    });
    if (outboxEnqueued > 0) {
      console.log(`[outbox] enqueued ${outboxEnqueued} booking event(s) from PUT /api/state`);
      if (inlineOutboxWorker) void inlineOutboxWorker.tick();
    }
    bumpStateDataVersion();
    notifyScopeChanged(req, ["state"]);
    setStateRevisionHeader(res);
    setStateDataVersionHeader(res);
    res.json(await buildHydratedStateWithOpeningSql(prisma, strippedState));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save state" });
  }
});

app.get("/api/opening-balances", requireAuth, async (_req, res) => {
  try {
    const row = await getOrInitState();
    await ensureOpeningSqlBackfilled(prisma, row.data, toPrismaJson);
    res.json(await buildOpeningBalancesApiPayload(prisma));
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error("[GET /api/opening-balances] Failed to load opening balances:", message);
    res.status(500).json({
      error: "Failed to load opening balances",
      details: process.env.NODE_ENV === "development" ? message : undefined,
    });
  }
});

app.put("/api/opening-balances", requireAuth, async (req, res) => {
  try {
    const parsed = OpeningSqlByYearSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid opening balances payload" });
    }

    await prisma.$transaction(async (tx) => {
      await persistOpeningBalancesApiPayload(tx, parsed.data);
    });
    notifyScopeChanged(req, ["opening", "state"]);
    setStateRevisionHeader(res);
    res.json(await buildOpeningBalancesApiPayload(prisma));
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error("[PUT /api/opening-balances] Failed to save opening balances:", message);
    res.status(500).json({
      error: "Failed to save opening balances",
      details: process.env.NODE_ENV === "development" ? message : undefined,
    });
  }
});

app.get("/api/debt-details", requireAuth, async (_req, res) => {
  try {
    const row = await getOrInitState();
    await ensureOpeningSqlBackfilled(prisma, row.data, toPrismaJson);
    res.json(await buildDebtDetailsApiPayload(prisma));
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error("[GET /api/debt-details] Failed to load debt details:", message);
    res.status(500).json({
      error: "Failed to load debt details",
      details: process.env.NODE_ENV === "development" ? message : undefined,
    });
  }
});

app.put("/api/debt-details", requireAuth, async (req, res) => {
  try {
    const parsed = OpeningSqlByYearSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid debt details payload" });
    }

    await prisma.$transaction(async (tx) => {
      await persistDebtDetailsApiPayload(tx, parsed.data);
    });
    notifyScopeChanged(req, ["debt", "state"]);
    setStateRevisionHeader(res);
    res.json(await buildDebtDetailsApiPayload(prisma));
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error("[PUT /api/debt-details] Failed to save debt details:", message);
    res.status(500).json({
      error: "Failed to save debt details",
      details: process.env.NODE_ENV === "development" ? message : undefined,
    });
  }
});

registerTaxGtgt01Routes(app, prisma, { toPrismaJson, readClientId });
registerNotificationRoutes(app, { prisma, requireAuth });
registerEInvoiceRoutes(app, { prisma, requireAuth });
registerRealtimeRoutes(app, { requireAuth, checkSuperAdmin, prisma });

// =====================================================================
// DATA LIFECYCLE (Trash / Archive / Versioning) — additive layer
// =====================================================================
const lifecycle = new LifecycleService(prisma);
const lifecycleCtx = (req: any) => ({
  actorUserId: req.user?.id ?? null,
  companyId: req.user?.companyId ?? null,
  sourceClientId: readClientId(req),
  reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
  role: req.user?.role ?? null,
  permissions: Array.isArray(req.user?.permissions) ? req.user.permissions : [],
});
const sendLifecycleError = (res: any, e: any) => {
  if (e instanceof LifecycleError) {
    const status =
      e.code === "NOT_FOUND"
        ? 404
        : e.code === "FORBIDDEN" || e.code === "NO_OWNER"
          ? 403
          : ["ILLEGAL_TRANSITION", "DUPLICATE", "NOT_APPROVED", "IN_USE"].includes(e.code)
            ? 409
            : 400;
    return res.status(status).json({ error: e.message, code: e.code });
  }
  console.error("[lifecycle] error:", e);
  return res.status(500).json({ error: "Lifecycle operation failed" });
};

app.get("/api/lc/trash", requireAuth, async (req, res) => {
  try {
    res.json(await lifecycle.listByStatus("SOFT_DELETED", (req.query.type as string) || undefined));
  } catch (e) {
    sendLifecycleError(res, e);
  }
});
app.get("/api/lc/archive", requireAuth, async (req, res) => {
  try {
    res.json(await lifecycle.listByStatus("ARCHIVED", (req.query.type as string) || undefined));
  } catch (e) {
    sendLifecycleError(res, e);
  }
});
app.get("/api/lc/pending-delete", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await lifecycle.listByStatus("PENDING_DELETE", (req.query.type as string) || undefined));
  } catch (e) {
    sendLifecycleError(res, e);
  }
});
app.get("/api/lc/:type/:id/versions", requireAuth, async (req, res) => {
  try {
    res.json(await lifecycle.listVersions(req.params.type, req.params.id));
  } catch (e) {
    sendLifecycleError(res, e);
  }
});
app.get("/api/lc/:type/:id/versions/:version", requireAuth, async (req, res) => {
  try {
    const rows = await lifecycle.getVersion(req.params.type, req.params.id, Number(req.params.version));
    if (!rows.length) return res.status(404).json({ error: "Version not found" });
    res.json(rows[0]);
  } catch (e) {
    sendLifecycleError(res, e);
  }
});
app.post("/api/lc/:type", requireAuth, async (req: any, res) => {
  try {
    const entity = req.body?.entity ?? req.body;
    if (!entity || typeof entity !== "object" || !entity.id) {
      return res.status(400).json({ error: "Body phải có entity.id" });
    }
    res.json(await lifecycle.createRecord(req.params.type, entity, lifecycleCtx(req)));
  } catch (e) {
    sendLifecycleError(res, e);
  }
});
app.patch("/api/lc/:type/:id", requireAuth, async (req: any, res) => {
  try {
    const patch = req.body?.patch ?? req.body ?? {};
    res.json(await lifecycle.updateRecord(req.params.type, req.params.id, patch, lifecycleCtx(req)));
  } catch (e) {
    sendLifecycleError(res, e);
  }
});
// SOFT DELETE — quyền delete:soft (staff giới hạn dữ liệu của mình, kiểm tra ở service)
app.delete("/api/lc/:type/:id", requireAuth, checkPermission("delete:soft"), async (req: any, res) => {
  try {
    const result = await lifecycle.deleteRecord(req.params.type, req.params.id, lifecycleCtx(req));
    // Trả về phiên bản state mới (lifecycle vừa bump) để client cập nhật, tránh PUT /state sau đó
    // bị coi là xung đột rồi hợp nhất sai (vd: mất phần hoàn tác tồn kho).
    setStateDataVersionHeader(res);
    res.json(result);
  } catch (e) {
    sendLifecycleError(res, e);
  }
});
// RESTORE — quyền delete:restore
app.post("/api/lc/:type/:id/restore", requireAuth, checkPermission("delete:restore"), async (req: any, res) => {
  try {
    res.json(await lifecycle.restoreRecord(req.params.type, req.params.id, lifecycleCtx(req)));
  } catch (e) {
    sendLifecycleError(res, e);
  }
});
app.post("/api/lc/:type/:id/archive", requireAuth, async (req: any, res) => {
  try {
    res.json(await lifecycle.archiveRecord(req.params.type, req.params.id, lifecycleCtx(req)));
  } catch (e) {
    sendLifecycleError(res, e);
  }
});
// REQUEST hard delete (admin) — quyền delete:request
app.post("/api/lc/:type/:id/request-delete", requireAuth, checkPermission("delete:request"), async (req: any, res) => {
  try {
    res.json(await lifecycle.requestDelete(req.params.type, req.params.id, lifecycleCtx(req)));
  } catch (e) {
    sendLifecycleError(res, e);
  }
});
// APPROVE hard delete (super admin) — quyền delete:approve hoặc delete:hard
app.post(
  "/api/lc/:type/:id/approve-delete",
  requireAuth,
  checkAnyPermission(["delete:approve", "delete:hard"]),
  async (req: any, res) => {
    try {
      res.json(await lifecycle.approveDelete(req.params.type, req.params.id, lifecycleCtx(req)));
    } catch (e) {
      sendLifecycleError(res, e);
    }
  },
);
// HARD DELETE (super admin) — quyền delete:hard + confirm "DELETE" + đã duyệt + delay
app.post("/api/lc/:type/:id/hard-delete", requireAuth, checkPermission("delete:hard"), async (req: any, res) => {
  try {
    const confirmText = String(req.body?.confirm ?? req.body?.confirmText ?? "");
    res.json(await lifecycle.hardDelete(req.params.type, req.params.id, lifecycleCtx(req), { confirmText }));
  } catch (e) {
    sendLifecycleError(res, e);
  }
});
// (Giữ tương thích cũ) pending-delete & purge — chỉ admin cấp cao
app.post("/api/lc/:type/:id/pending-delete", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const grace = Number(process.env.LC_PURGE_GRACE_DAYS || 7);
    res.json(await lifecycle.markPendingDelete(req.params.type, req.params.id, grace, lifecycleCtx(req)));
  } catch (e) {
    sendLifecycleError(res, e);
  }
});
app.post("/api/lc/:type/:id/purge", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    res.json(await lifecycle.purgeRecord(req.params.type, req.params.id, lifecycleCtx(req)));
  } catch (e) {
    sendLifecycleError(res, e);
  }
});

app.post("/api/reset", requireAuth, requireAdmin, async (req, res) => {
  try {
    const nextDefaultState = buildDefaultState();
    const strippedState = stripOpeningSqlState(nextDefaultState);
    await prisma.$transaction(async (tx) => {
      await tx.debtDetail.deleteMany({});
      await tx.openingBalanceRollover.deleteMany({});
      await tx.openingBalance.deleteMany({});
      await tx.appState.upsert({
        where: { id: 1 },
        create: { id: 1, data: toPrismaJson(strippedState) },
        update: { data: toPrismaJson(strippedState) },
      });
    });
    bumpStateDataVersion();
    notifyScopeChanged(req, ["reset", "state"]);
    setStateRevisionHeader(res);
    setStateDataVersionHeader(res);
    res.json(await buildHydratedStateWithOpeningSql(prisma, strippedState));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reset state" });
  }
});

const port = Number(process.env.PORT || 4000);
let inlineOutboxWorker: OutboxWorker | null = null;
// Bind to all interfaces so Docker port-mapping works.
(async () => {
  try {
    await ensureBackupDirs();
    if (isSqliteDatabase()) {
      await ensureUserTable();
      await ensureGtgt01DataTable();
      await ensureRbacTables();
    }
    await seedRbacDefaults();
    await bootstrapSuperAdmin();
    await bootstrapAdmin();
    await configureRealtimeRedisPubSub();
    if (process.env.OUTBOX_DISPATCH_INLINE === "1") {
      console.log("[outbox] inline dispatcher enabled (OUTBOX_DISPATCH_INLINE=1)");
      inlineOutboxWorker = startOutboxWorker({
        prisma,
        ensurePublisher: async () => {
          const pub = await getRedis();
          if (pub) realtimeBus.setPublisher(pub as import("redis").RedisClientType);
        },
      });
    }
    await ensureLifecycleTables(prisma);
    startLifecycleJobs(prisma, redis);
  } catch (e) {
    console.warn("[auth] bootstrap admin failed:", e);
  }
  const autoHours = Number(process.env.AUTO_DB_BACKUP_HOURS || 0);
  if (autoHours > 0 && isSqliteDatabase()) {
    const ms = autoHours * 3600 * 1000;
    setInterval(() => void copySqliteToAutoBackupFolder(), ms);
    void copySqliteToAutoBackupFolder();
    console.log(`[backup] AUTO_DB_BACKUP_HOURS=${autoHours} (SQLite → ${path.join(BACKUP_BASE, "SqliteAuto")})`);
  }
  startTaxXmlFileWatcher(prisma);
  server.listen(port, "0.0.0.0", () => {
    console.log(`Backend listening on http://0.0.0.0:${port}`);
  });
})();

