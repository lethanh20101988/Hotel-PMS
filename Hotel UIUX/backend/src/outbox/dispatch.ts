import type { RealtimeEnvelope } from "../realtime/eventTypes.js";
import { realtimeBus } from "../realtime/redisEventBus.js";
import {
  bumpOutboxDispatchFailure,
  bumpOutboxDispatched,
  recordDispatchLatency,
} from "../realtime/monitoring.js";
import { logOutboxDispatchFail, logOutboxDispatchSuccess } from "./logger.js";
import type { OutboxEnvelopePayload } from "./types.js";

export type OutboxRow = {
  id: string;
  eventId: string;
  eventType: string;
  payload: unknown;
};

function parseEnvelope(raw: unknown): OutboxEnvelopePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as OutboxEnvelopePayload;
  if (!o.type || !Array.isArray(o.targetRooms) || !o.payload) return null;
  return o;
}

/**
 * Publish outbox row lên Redis với eventId ổn định — idempotent trên WS client.
 * Worker gọi hàm này; API replicas subscribe Redis và deliver WS theo room.
 */
export async function dispatchOutboxRow(row: OutboxRow): Promise<RealtimeEnvelope> {
  const envelope = parseEnvelope(row.payload);
  if (!envelope) {
    throw new Error(`Invalid outbox payload for row ${row.id}`);
  }

  const started = Date.now();
  try {
    const full = await realtimeBus.publishWithId(row.eventId, {
      type: envelope.type,
      targetRooms: envelope.targetRooms,
      companyId: envelope.companyId,
      payload: envelope.payload,
    });
    recordDispatchLatency(Date.now() - started);
    bumpOutboxDispatched();
    logOutboxDispatchSuccess(row.eventId, envelope.type, envelope.targetRooms);
    return full;
  } catch (err) {
    bumpOutboxDispatchFailure();
    const message = String((err as Error)?.message || err);
    logOutboxDispatchFail(row.eventId, envelope.type, message);
    throw err;
  }
}
