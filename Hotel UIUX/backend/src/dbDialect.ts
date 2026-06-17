import { Prisma } from "@prisma/client";

export type DatabaseKind = "sqlite" | "postgresql";

export function getDatabaseKind(databaseUrl?: string): DatabaseKind {
  const url = String(databaseUrl ?? process.env.DATABASE_URL ?? "").trim().toLowerCase();
  if (url.startsWith("file:") || url.includes("sqlite")) return "sqlite";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) return "postgresql";
  return "postgresql";
}

export function isSqliteDatabase(databaseUrl?: string): boolean {
  return getDatabaseKind(databaseUrl) === "sqlite";
}

/** Timestamp for raw SQL (PostgreSQL TIMESTAMP + SQLite TEXT/DATETIME). */
export function dbNow(): Date {
  return new Date();
}

/** Raw SQL TIMESTAMP columns may be Date (PostgreSQL) or string (SQLite). */
export function isTimestampPast(value: string | Date): boolean {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) && ms <= Date.now();
}

export async function ensureTableColumn(
  prisma: { $queryRawUnsafe: (query: string) => Promise<unknown>; $executeRawUnsafe: (query: string) => Promise<unknown> },
  table: string,
  column: string,
  definition: string,
  databaseUrl?: string,
) {
  const kind = getDatabaseKind(databaseUrl);
  if (kind === "sqlite") {
    const rows = (await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`)) as Array<{ name: string }>;
    if (rows.some((r) => r.name === column)) return;
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
    return;
  }
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}'`,
  )) as Array<{ column_name: string }>;
  if (rows.length > 0) return;
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
}

/** INSERT OR IGNORE (SQLite) vs INSERT ... ON CONFLICT DO NOTHING (PostgreSQL). */
export function insertIgnoreSql(
  table: string,
  columns: string[],
  conflictColumns: string[],
  values: Prisma.Sql,
): Prisma.Sql {
  const colList = columns.map((c) => `"${c}"`).join(", ");
  const tableRef = Prisma.raw(`"${table}"`);
  const colRef = Prisma.raw(colList);
  if (isSqliteDatabase()) {
    return Prisma.sql`INSERT OR IGNORE INTO ${tableRef} (${colRef}) VALUES (${values})`;
  }
  const conflictRef = Prisma.raw(conflictColumns.map((c) => `"${c}"`).join(", "));
  return Prisma.sql`INSERT INTO ${tableRef} (${colRef}) VALUES (${values}) ON CONFLICT (${conflictRef}) DO NOTHING`;
}
