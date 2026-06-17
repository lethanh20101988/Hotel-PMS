import crypto from "node:crypto";

/** UUID v4 — idempotent event id cho Redis wire + WS client dedup. */
export function generateEventId(): string {
  return crypto.randomUUID();
}
