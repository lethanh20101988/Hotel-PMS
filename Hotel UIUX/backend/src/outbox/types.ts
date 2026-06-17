import type { RealtimeEventType } from "../realtime/eventTypes.js";

/** Payload lưu trong event_outbox.payload — worker deserialize và publish Redis. */
export type OutboxEnvelopePayload = {
  type: RealtimeEventType;
  targetRooms: string[];
  companyId?: string;
  payload: Record<string, unknown>;
  sourceClientId?: string;
};

export type OutboxStatus = "pending" | "processing" | "sent" | "failed";

export const OUTBOX_MAX_ATTEMPTS = 10;
export const OUTBOX_POLL_INTERVAL_MS = Number(process.env.OUTBOX_POLL_INTERVAL_MS || 100);
export const OUTBOX_BATCH_SIZE = 50;
export const STALE_PROCESSING_MS = 5 * 60 * 1000;

/**
 * Ví dụ payload Redis / WebSocket sau khi worker publish order_updated:
 *
 * {
 *   "eventId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
 *   "event": "order_updated",
 *   "at": 1718380800000,
 *   "companyId": "default-company",
 *   "payload": {
 *     "orderId": "booking-abc123",
 *     "companyId": "default-company",
 *     "status": "active",
 *     "changedFields": ["services", "paidAmount"]
 *   }
 * }
 */
