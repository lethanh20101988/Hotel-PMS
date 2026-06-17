import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { dispatchOutboxRow } from "./dispatch.js";
import { logOutboxRecovery, logOutboxWorkerRetry } from "./logger.js";
import {
  bumpOutboxPoll,
  bumpOutboxRequeued,
} from "../realtime/monitoring.js";
import {
  OUTBOX_BATCH_SIZE,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_POLL_INTERVAL_MS,
  STALE_PROCESSING_MS,
} from "./types.js";

export type OutboxWorkerOptions = {
  prisma: PrismaClient;
  pollIntervalMs?: number;
  batchSize?: number;
  /** Gọi trước mỗi poll (kết nối Redis publisher). */
  ensurePublisher?: () => Promise<void>;
};

type LockedRow = {
  id: string;
  event_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
};

/**
 * Event Dispatcher — batch pending → processing → Redis → sent.
 * FOR UPDATE SKIP LOCKED: nhiều worker không xử lý trùng row.
 */
export class OutboxWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly opts: OutboxWorkerOptions;

  constructor(opts: OutboxWorkerOptions) {
    this.opts = opts;
  }

  start() {
    if (this.timer) return;
    const interval = this.opts.pollIntervalMs ?? OUTBOX_POLL_INTERVAL_MS;
    const batch = this.opts.batchSize ?? OUTBOX_BATCH_SIZE;
    console.log(`[outbox-worker] started poll=${interval}ms batch=${batch}`);
    void this.recoverStaleProcessing();
    this.timer = setInterval(() => void this.tick(), interval);
    void this.tick();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** processing > 5 phút → pending (worker crash giữa publish và mark sent). */
  private async recoverStaleProcessing() {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
    const n = await this.opts.prisma.eventOutbox.updateMany({
      where: { status: "processing", updatedAt: { lt: staleBefore } },
      data: { status: "pending" },
    });
    if (n.count > 0) logOutboxRecovery(n.count);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    bumpOutboxPoll();
    try {
      if (this.opts.ensurePublisher) await this.opts.ensurePublisher();
      await this.recoverStaleProcessing();
      await this.processBatch();
    } catch (err) {
      console.error("[outbox-worker] tick error:", err);
    } finally {
      this.running = false;
    }
  }

  private async processBatch(): Promise<void> {
    const batchSize = this.opts.batchSize ?? OUTBOX_BATCH_SIZE;
    const prisma = this.opts.prisma;

    const locked = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<LockedRow[]>(
        Prisma.sql`
          SELECT id, event_id, event_type, payload, attempts
          FROM event_outbox
          WHERE status = 'pending'
          ORDER BY created_at ASC
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        `,
      );
      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);
      await tx.eventOutbox.updateMany({
        where: { id: { in: ids } },
        data: { status: "processing" },
      });
      return rows;
    });

    for (const row of locked) {
      await this.dispatchOne(row);
    }
  }

  private async dispatchOne(row: LockedRow): Promise<void> {
    const prisma = this.opts.prisma;
    const outboxRow = {
      id: row.id,
      eventId: row.event_id,
      eventType: row.event_type,
      payload: row.payload,
    };

    try {
      await dispatchOutboxRow(outboxRow);
      await prisma.eventOutbox.update({
        where: { id: row.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          lastError: null,
        },
      });
    } catch (err) {
      const attempts = row.attempts + 1;
      const message = String((err as Error)?.message || err);
      const failed = attempts >= OUTBOX_MAX_ATTEMPTS;
      await prisma.eventOutbox.update({
        where: { id: row.id },
        data: {
          status: failed ? "failed" : "pending",
          attempts,
          lastError: message.slice(0, 2000),
        },
      });
      if (!failed) {
        bumpOutboxRequeued();
        logOutboxWorkerRetry(row.event_id, attempts, OUTBOX_MAX_ATTEMPTS);
      }
    }
  }
}

export function startOutboxWorker(opts: OutboxWorkerOptions): OutboxWorker {
  const worker = new OutboxWorker(opts);
  worker.start();
  return worker;
}
