import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

export type SchemaReadyResult = {
  ok: boolean;
  waitedMs: number;
  reason?: string;
};

const DEFAULT_MAX_WAIT_MS = 180_000;
const DEFAULT_POLL_MS = 3_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Chờ DB schema sẵn sàng cho outbox worker.
 * - Bảng event_outbox tồn tại
 * - Cột event_id tồn tại
 * Retry trong maxWaitMs, sau đó trả ok=false (caller nên exit).
 */
export async function waitForSchemaReady(
  prisma: PrismaClient,
  options?: { maxWaitMs?: number; pollMs?: number },
): Promise<SchemaReadyResult> {
  const envWait = Number(process.env.SCHEMA_WAIT_SECONDS || 0) * 1000;
  const maxWaitMs = options?.maxWaitMs ?? (envWait > 0 ? envWait : DEFAULT_MAX_WAIT_MS);
  const pollMs = options?.pollMs ?? DEFAULT_POLL_MS;
  const start = Date.now();

  console.log(`[schema] waiting for event_outbox + event_id (max ${maxWaitMs}ms)...`);

  while (Date.now() - start < maxWaitMs) {
    const ready = await checkOutboxSchema(prisma);
    if (ready.ok) {
      const waitedMs = Date.now() - start;
      console.log(`[schema] ready after ${waitedMs}ms`);
      return { ok: true, waitedMs };
    }
    console.warn(`[schema] not ready: ${ready.reason} — retry in ${pollMs}ms`);
    await sleep(pollMs);
  }

  return {
    ok: false,
    waitedMs: Date.now() - start,
    reason: "timeout waiting for event_outbox schema",
  };
}

async function checkOutboxSchema(prisma: PrismaClient): Promise<{ ok: boolean; reason?: string }> {
  try {
    const table = await prisma.$queryRaw<Array<{ exists: boolean }>>(
      Prisma.sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'event_outbox'
        ) AS exists
      `,
    );
    if (!table[0]?.exists) {
      return { ok: false, reason: "table event_outbox missing" };
    }

    const col = await prisma.$queryRaw<Array<{ exists: boolean }>>(
      Prisma.sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'event_outbox'
            AND column_name = 'event_id'
        ) AS exists
      `,
    );
    if (!col[0]?.exists) {
      return { ok: false, reason: "column event_id missing" };
    }

    await prisma.$queryRaw(Prisma.sql`SELECT 1 FROM "event_outbox" LIMIT 0`);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String((err as Error)?.message || err) };
  }
}
