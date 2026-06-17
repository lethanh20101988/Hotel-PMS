/**
 * One-shot: copy all business data from SQLite dev.db → PostgreSQL.
 * Preserves IDs, JSON blobs (AppState formulas/logic), and FK order.
 *
 * Usage (inside Docker backend, /data/dev.db mounted):
 *   SQLITE_PATH=/data/dev.db node scripts/migrateSqliteToPostgres.mjs
 *
 * Env:
 *   SQLITE_PATH — path to SQLite file (required)
 *   DATABASE_URL — PostgreSQL URL (required)
 *   DRY_RUN=1 — only print counts, no writes
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";

const SQLITE_PATH = String(process.env.SQLITE_PATH || "").trim();
const DRY_RUN = /^(1|true|yes)$/i.test(String(process.env.DRY_RUN || ""));

if (!SQLITE_PATH || !existsSync(SQLITE_PATH)) {
  console.error("[migrate] SQLITE_PATH missing or file not found:", SQLITE_PATH || "(empty)");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("[migrate] DATABASE_URL is required");
  process.exit(1);
}

const prisma = new PrismaClient();

function sqliteJson(sql) {
  try {
    const out = execFileSync("sqlite3", ["-json", SQLITE_PATH, sql], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    });
    const trimmed = out.trim();
    if (!trimmed) return [];
    return JSON.parse(trimmed);
  } catch (err) {
    if (err?.status === 0) return [];
    throw err;
  }
}

function tableSqlName(name) {
  if (name === "entity_lifecycle" || name === "record_versions") return name;
  return `"${name}"`;
}

function sqliteCount(table) {
  const rows = sqliteJson(`SELECT COUNT(*) AS c FROM ${tableSqlName(table)}`);
  return Number(rows[0]?.c || 0);
}

/** SQLite may store ISO strings or epoch ms in TEXT/DATETIME columns. */
function parseDate(val) {
  if (val == null || val === "") return null;
  if (val instanceof Date) return val;
  if (typeof val === "number") return new Date(val);
  const s = String(val).trim();
  if (/^\d{12,}$/.test(s)) return new Date(Number(s));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseBool(val, fallback = false) {
  if (val === true || val === false) return val;
  if (val == null) return fallback;
  if (typeof val === "number") return val !== 0;
  return String(val).toLowerCase() === "true" || String(val) === "1";
}

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(String(val));
  } catch {
    return val;
  }
}

function toBigInt(val) {
  if (val == null || val === "") return BigInt(0);
  return BigInt(val);
}

async function createManyBatched(label, rows, mapper, batchSize = 250) {
  if (!rows.length) return 0;
  let written = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    await mapper(chunk);
    written += chunk.length;
    if (rows.length > batchSize) {
      console.log(`[migrate] ${label}: ${written}/${rows.length}`);
    }
  }
  return written;
}

async function truncateTarget() {
  console.log("[migrate] Truncating PostgreSQL tables (CASCADE)...");
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "record_versions",
      "entity_lifecycle",
      "DebtDetail",
      "OpeningBalance",
      "OpeningBalanceRollover",
      "InvoiceImportBatch",
      "Notification",
      "Gtgt01Data",
      "QrSession",
      "Otp",
      "ApprovalRequest",
      "AuditLog",
      "AppState",
      "RolePermission",
      "User",
      "Role",
      "Permission",
      "Company"
    RESTART IDENTITY CASCADE
  `);
}

async function migrateCompanies() {
  const rows = sqliteJson(`SELECT * FROM "Company"`);
  if (!rows.length) return 0;
  await prisma.company.createMany({
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      createdAt: parseDate(r.createdAt) ?? new Date(),
      updatedAt: parseDate(r.updatedAt) ?? new Date(),
    })),
  });
  return rows.length;
}

async function migratePermissions() {
  const rows = sqliteJson(`SELECT * FROM "Permission"`);
  if (!rows.length) return 0;
  await prisma.permission.createMany({
    data: rows.map((r) => ({
      id: r.id,
      companyId: r.companyId ?? null,
      name: r.name,
      description: r.description ?? null,
      createdAt: parseDate(r.createdAt) ?? new Date(),
      updatedAt: parseDate(r.updatedAt) ?? new Date(),
    })),
  });
  return rows.length;
}

async function migrateRoles() {
  const rows = sqliteJson(`SELECT * FROM "Role"`);
  if (!rows.length) return 0;
  await prisma.role.createMany({
    data: rows.map((r) => ({
      id: r.id,
      companyId: r.companyId ?? null,
      name: r.name,
      description: r.description ?? null,
      isSystem: parseBool(r.isSystem),
      createdAt: parseDate(r.createdAt) ?? new Date(),
      updatedAt: parseDate(r.updatedAt) ?? new Date(),
    })),
  });
  return rows.length;
}

async function migrateRolePermissions() {
  const rows = sqliteJson(`SELECT * FROM "RolePermission"`);
  if (!rows.length) return 0;
  await prisma.rolePermission.createMany({
    data: rows.map((r) => ({
      roleId: r.roleId,
      permissionId: r.permissionId,
      createdAt: parseDate(r.createdAt) ?? new Date(),
    })),
  });
  return rows.length;
}

async function migrateUsers() {
  const rows = sqliteJson(`SELECT * FROM "User"`);
  if (!rows.length) return 0;
  await prisma.user.createMany({
    data: rows.map((r) => ({
      id: r.id,
      username: r.username ?? null,
      email: r.email ?? null,
      phone: r.phone ?? null,
      passwordHash: r.passwordHash,
      role: r.role,
      roleId: r.roleId ?? null,
      companyId: r.companyId ?? null,
      status: r.status,
      createdAt: parseDate(r.createdAt) ?? new Date(),
      updatedAt: parseDate(r.updatedAt) ?? new Date(),
      lastLoginAt: parseDate(r.lastLoginAt),
    })),
  });
  return rows.length;
}

async function migrateAppState() {
  const rows = sqliteJson(`SELECT * FROM "AppState"`);
  if (!rows.length) return 0;
  for (const r of rows) {
    const data = parseJson(r.data);
    if (!data || typeof data !== "object") {
      throw new Error(`AppState id=${r.id}: invalid JSON data blob`);
    }
    await prisma.appState.create({
      data: {
        id: Number(r.id),
        data,
        createdAt: parseDate(r.createdAt) ?? new Date(),
        updatedAt: parseDate(r.updatedAt) ?? new Date(),
      },
    });
  }
  return rows.length;
}

async function migrateAuditLogs() {
  const total = sqliteCount("AuditLog");
  if (!total) return 0;
  const batchSize = 25;
  let written = 0;
  for (let offset = 0; offset < total; offset += batchSize) {
    const rows = sqliteJson(`SELECT * FROM "AuditLog" LIMIT ${batchSize} OFFSET ${offset}`);
    if (!rows.length) break;
    await prisma.auditLog.createMany({
      data: rows.map((r) => ({
        id: r.id,
        companyId: r.companyId ?? null,
        actorUserId: r.actorUserId ?? null,
        action: r.action,
        resource: r.resource,
        resourceId: r.resourceId ?? null,
        before: r.before == null ? undefined : parseJson(r.before),
        after: r.after == null ? undefined : parseJson(r.after),
        ip: r.ip ?? null,
        userAgent: r.userAgent ?? null,
        createdAt: parseDate(r.createdAt) ?? new Date(),
      })),
    });
    written += rows.length;
    console.log(`[migrate] AuditLog: ${written}/${total}`);
  }
  return written;
}

async function migrateApprovalRequests() {
  const rows = sqliteJson(`SELECT * FROM "ApprovalRequest"`);
  if (!rows.length) return 0;
  await prisma.approvalRequest.createMany({
    data: rows.map((r) => ({
      id: r.id,
      companyId: r.companyId ?? null,
      resource: r.resource,
      resourceId: r.resourceId ?? null,
      payload: parseJson(r.payload) ?? {},
      status: r.status,
      requestedById: r.requestedById,
      managerById: r.managerById ?? null,
      adminById: r.adminById ?? null,
      requestedAt: parseDate(r.requestedAt) ?? new Date(),
      managerAt: parseDate(r.managerAt),
      adminAt: parseDate(r.adminAt),
      rejectionReason: r.rejectionReason ?? null,
    })),
  });
  return rows.length;
}

async function migrateOtps() {
  const rows = sqliteJson(`SELECT * FROM "Otp"`);
  if (!rows.length) return 0;
  await prisma.otp.createMany({
    data: rows.map((r) => ({
      id: r.id,
      target: r.target,
      targetType: r.targetType,
      purpose: r.purpose,
      codeHash: r.codeHash,
      expiresAt: parseDate(r.expiresAt) ?? new Date(),
      verified: parseBool(r.verified),
      consumedAt: parseDate(r.consumedAt),
      attempts: Number(r.attempts ?? 0),
      createdAt: parseDate(r.createdAt) ?? new Date(),
      verifiedAt: parseDate(r.verifiedAt),
    })),
  });
  return rows.length;
}

async function migrateQrSessions() {
  const rows = sqliteJson(`SELECT * FROM "QrSession"`);
  if (!rows.length) return 0;
  await prisma.qrSession.createMany({
    data: rows.map((r) => ({
      id: r.id,
      status: r.status,
      userId: r.userId ?? null,
      expiresAt: parseDate(r.expiresAt) ?? new Date(),
      consumedAt: parseDate(r.consumedAt),
      createdAt: parseDate(r.createdAt) ?? new Date(),
      confirmedAt: parseDate(r.confirmedAt),
    })),
  });
  return rows.length;
}

async function migrateGtgt01() {
  const rows = sqliteJson(`SELECT * FROM "Gtgt01Data"`);
  if (!rows.length) return 0;
  await prisma.gtgt01Data.createMany({
    data: rows.map((r) => ({
      id: Number(r.id),
      payload: parseJson(r.payload) ?? {},
      updatedAt: parseDate(r.updatedAt) ?? new Date(),
    })),
  });
  return rows.length;
}

async function migrateOpeningBalances() {
  const rows = sqliteJson(`SELECT * FROM "OpeningBalance"`);
  if (!rows.length) return 0;
  await prisma.openingBalance.createMany({
    data: rows.map((r) => ({
      yearKey: r.yearKey,
      accountCode: r.accountCode,
      debit: toBigInt(r.debit),
      credit: toBigInt(r.credit),
      originMode: r.originMode,
      readOnly: parseBool(r.readOnly),
      lockReason: r.lockReason ?? null,
      createdAt: parseDate(r.createdAt) ?? new Date(),
      updatedAt: parseDate(r.updatedAt) ?? new Date(),
    })),
  });
  return rows.length;
}

async function migrateDebtDetails() {
  const rows = sqliteJson(`SELECT * FROM "DebtDetail"`);
  if (!rows.length) return 0;
  await prisma.debtDetail.createMany({
    data: rows.map((r) => ({
      id: r.id,
      yearKey: r.yearKey,
      kind: r.kind,
      accountCode: r.accountCode,
      partnerId: r.partnerId ?? null,
      partnerCode: r.partnerCode ?? null,
      partnerName: r.partnerName,
      invoiceNo: r.invoiceNo,
      revenueType: r.revenueType,
      amount: toBigInt(r.amount),
      dueDate: r.dueDate ?? null,
      note: r.note ?? null,
      sourceInvoiceId: r.sourceInvoiceId ?? null,
      sourceInvoiceNumber: r.sourceInvoiceNumber ?? null,
      sourceInvoiceDate: r.sourceInvoiceDate ?? null,
      sourceYearKey: r.sourceYearKey ?? null,
      openingYearKey: r.openingYearKey ?? null,
      originMode: r.originMode,
      readOnly: parseBool(r.readOnly),
      lockReason: r.lockReason ?? null,
      syncStatus: r.syncStatus,
      createdAt: parseDate(r.createdAt) ?? new Date(),
      updatedAt: parseDate(r.updatedAt) ?? new Date(),
    })),
  });
  return rows.length;
}

async function migrateOpeningBalanceRollovers() {
  const rows = sqliteJson(`SELECT * FROM "OpeningBalanceRollover"`);
  if (!rows.length) return 0;
  await prisma.openingBalanceRollover.createMany({
    data: rows.map((r) => ({
      yearKey: r.yearKey,
      sourceYearKey: r.sourceYearKey,
      generatedAt: parseDate(r.generatedAt) ?? new Date(),
      lockedAccountCodes: r.lockedAccountCodes == null ? undefined : parseJson(r.lockedAccountCodes),
      lockedDebtKinds: r.lockedDebtKinds == null ? undefined : parseJson(r.lockedDebtKinds),
      updatedAt: parseDate(r.updatedAt) ?? new Date(),
    })),
  });
  return rows.length;
}

async function migrateInvoiceImportBatches() {
  const rows = sqliteJson(`SELECT * FROM "InvoiceImportBatch"`);
  if (!rows.length) return 0;
  await prisma.invoiceImportBatch.createMany({
    data: rows.map((r) => ({
      id: r.id,
      createdAt: parseDate(r.createdAt) ?? new Date(),
      updatedAt: parseDate(r.updatedAt) ?? new Date(),
      fileName: r.fileName,
      filePath: r.filePath ?? null,
      queueStatus: r.queueStatus,
      batchStatus: r.batchStatus,
      payload: parseJson(r.payload) ?? {},
    })),
  });
  return rows.length;
}

async function migrateNotifications() {
  const rows = sqliteJson(`SELECT * FROM "Notification"`);
  if (!rows.length) return 0;
  await prisma.notification.createMany({
    data: rows.map((r) => ({
      id: r.id,
      createdAt: parseDate(r.createdAt) ?? new Date(),
      readAt: parseDate(r.readAt),
      kind: r.kind,
      title: r.title,
      body: r.body,
      data: parseJson(r.data) ?? {},
    })),
  });
  return rows.length;
}

async function migrateEntityLifecycle() {
  const rows = sqliteJson(`SELECT * FROM entity_lifecycle`);
  if (!rows.length) return 0;
  for (const r of rows) {
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO entity_lifecycle (
          id, company_id, entity_type, entity_id, status, version, data_json,
          deleted_at, deleted_by, archived_at, purge_after, reason,
          created_at, updated_at, approved, requested_by, requested_at, approved_by, approved_at
        ) VALUES (
          ${r.id},
          ${r.company_id ?? null},
          ${r.entity_type},
          ${r.entity_id},
          ${r.status},
          ${Number(r.version ?? 1)},
          ${r.data_json ?? null},
          ${r.deleted_at ?? null},
          ${r.deleted_by ?? null},
          ${r.archived_at ?? null},
          ${r.purge_after ?? null},
          ${r.reason ?? null},
          ${r.created_at ?? new Date().toISOString()},
          ${r.updated_at ?? new Date().toISOString()},
          ${Number(r.approved ?? 0)},
          ${r.requested_by ?? null},
          ${r.requested_at ?? null},
          ${r.approved_by ?? null},
          ${r.approved_at ?? null}
        )
      `,
    );
  }
  return rows.length;
}

async function migrateRecordVersions() {
  const rows = sqliteJson(`SELECT * FROM record_versions`);
  if (!rows.length) return 0;
  for (const r of rows) {
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO record_versions (
          id, company_id, entity_type, entity_id, version, action, data_json, actor_user_id, created_at
        ) VALUES (
          ${r.id},
          ${r.company_id ?? null},
          ${r.entity_type},
          ${r.entity_id},
          ${Number(r.version)},
          ${r.action},
          ${r.data_json},
          ${r.actor_user_id ?? null},
          ${r.created_at ?? new Date().toISOString()}
        )
      `,
    );
  }
  return rows.length;
}

const STEPS = [
  ["Company", migrateCompanies],
  ["Permission", migratePermissions],
  ["Role", migrateRoles],
  ["RolePermission", migrateRolePermissions],
  ["User", migrateUsers],
  ["AppState", migrateAppState],
  ["AuditLog", migrateAuditLogs],
  ["ApprovalRequest", migrateApprovalRequests],
  ["Otp", migrateOtps],
  ["QrSession", migrateQrSessions],
  ["Gtgt01Data", migrateGtgt01],
  ["OpeningBalance", migrateOpeningBalances],
  ["DebtDetail", migrateDebtDetails],
  ["OpeningBalanceRollover", migrateOpeningBalanceRollovers],
  ["InvoiceImportBatch", migrateInvoiceImportBatches],
  ["Notification", migrateNotifications],
  ["entity_lifecycle", migrateEntityLifecycle],
  ["record_versions", migrateRecordVersions],
];

async function main() {
  console.log("[migrate] Source SQLite:", SQLITE_PATH);
  console.log("[migrate] Target:", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@"));

  const sourceCounts = {};
  for (const [name] of STEPS) {
    const table = name === "entity_lifecycle" || name === "record_versions" ? name : name;
    sourceCounts[name] = sqliteCount(table);
  }
  console.log("[migrate] SQLite row counts:", sourceCounts);

  if (DRY_RUN) {
    console.log("[migrate] DRY_RUN=1 — no changes written.");
    return;
  }

  await truncateTarget();

  const results = {};
  for (const [name, fn] of STEPS) {
    const n = await fn();
    results[name] = n;
    console.log(`[migrate] ${name}: ${n} rows`);
  }

  console.log("[migrate] Done. Summary:", results);
  console.log("[migrate] AppState JSON preserved — restart frontend/backend clients to reload state.");
}

main()
  .catch((err) => {
    console.error("[migrate] FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
