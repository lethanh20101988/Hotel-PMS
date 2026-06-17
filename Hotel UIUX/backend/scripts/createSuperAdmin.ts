/**
 * One-off: create super_admin user. Usage:
 *   DATABASE_URL="file:..." npx tsx scripts/createSuperAdmin.ts email password
 */
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const email = process.argv[2]?.toLowerCase().trim();
const password = process.argv[3];
if (!email || !password) {
  console.error("Usage: npx tsx scripts/createSuperAdmin.ts <email> <password>");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRaw<Array<{ id: string; email: string; role: string }>>(
    Prisma.sql`SELECT id, email, role FROM "User" WHERE email = ${email} LIMIT 1`
  );
  const existing = rows[0];
  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date().toISOString();

  if (existing) {
    if (existing.role === "super_admin") {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE "User" SET passwordHash = ${passwordHash}, status = 'active', updatedAt = ${now} WHERE id = ${existing.id}`
      );
      console.log(`Updated password for existing super_admin: ${email}`);
      return;
    }
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "User" SET role = 'super_admin', roleId = 'role_super_admin', companyId = NULL, passwordHash = ${passwordHash}, status = 'active', updatedAt = ${now} WHERE id = ${existing.id}`
    );
    console.log(`Promoted existing user to super_admin: ${email}`);
    return;
  }

  const roleRows = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM "Role" WHERE name = 'super_admin' AND companyId IS NULL LIMIT 1`
  );
  if (!roleRows[0]) throw new Error("super_admin role not found — run migrations first");

  const id = crypto.randomUUID();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "User" (id, username, email, phone, passwordHash, role, roleId, companyId, status, createdAt, updatedAt)
      VALUES (${id}, NULL, ${email}, NULL, ${passwordHash}, 'super_admin', 'role_super_admin', NULL, 'active', ${now}, ${now})
    `
  );
  console.log(`Created super_admin: ${email} (id=${id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
