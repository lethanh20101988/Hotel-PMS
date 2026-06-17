import type { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { companyRoom, userRoom } from "../realtime/rooms.js";
import { generateEventId } from "./eventId.js";
import { logOutboxEnqueue } from "./logger.js";
import type { OutboxEnvelopePayload } from "./types.js";

type TxClient = Pick<PrismaClient, "eventOutbox">;

export async function enqueueOutboxEvents(
  tx: TxClient,
  events: OutboxEnvelopePayload[],
): Promise<number> {
  if (events.length === 0) return 0;

  const rows = events.map((ev) => {
    const eventId = generateEventId();
    return {
      eventId,
      eventType: ev.type,
      payload: ev as unknown as Prisma.InputJsonValue,
      status: "pending",
    };
  });

  await tx.eventOutbox.createMany({ data: rows });

  for (const row of rows) {
    logOutboxEnqueue(row.eventId, row.eventType);
  }

  return rows.length;
}

/** Notification — ghi outbox trong cùng transaction với notification row. */
export function buildNotificationOutboxEvent(opts: {
  notificationId: string;
  companyId: string;
  userId?: string;
  kind: string;
  title: string;
}): OutboxEnvelopePayload {
  const targetRooms = [companyRoom(opts.companyId)];
  if (opts.userId) targetRooms.push(userRoom(opts.userId));

  return {
    type: "notification_created",
    targetRooms,
    companyId: opts.companyId,
    payload: {
      notificationId: opts.notificationId,
      companyId: opts.companyId,
      userId: opts.userId,
      kind: opts.kind,
      title: opts.title,
    },
  };
}
