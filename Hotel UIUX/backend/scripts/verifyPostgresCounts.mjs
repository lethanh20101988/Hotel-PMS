import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const s = await p.appState.findUnique({ where: { id: 1 } });
const jsonLen = JSON.stringify(s?.data ?? null).length;
console.log("AppState json bytes:", jsonLen);
console.log("Users:", await p.user.count());
console.log("AuditLog:", await p.auditLog.count());
console.log("Notification:", await p.notification.count());
console.log("entity_lifecycle:", (
  await p.$queryRawUnsafe("SELECT COUNT(*)::int AS c FROM entity_lifecycle")
)[0]?.c);
await p.$disconnect();
