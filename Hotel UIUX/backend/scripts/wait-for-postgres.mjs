/**
 * Chờ PostgreSQL accept connection qua Prisma (dùng DATABASE_URL).
 */
import { PrismaClient } from "@prisma/client";

const maxWaitMs = Number(process.env.DB_WAIT_SECONDS || 120) * 1000;
const pollMs = 2000;
const start = Date.now();

console.log(`[wait-db] waiting for PostgreSQL (max ${maxWaitMs}ms)...`);

while (Date.now() - start < maxWaitMs) {
  const prisma = new PrismaClient();
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    await prisma.$disconnect();
    console.log("[wait-db] PostgreSQL is ready");
    process.exit(0);
  } catch {
    try {
      await prisma.$disconnect();
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

console.error(`[wait-db] timeout — PostgreSQL not ready after ${maxWaitMs}ms`);
process.exit(1);
