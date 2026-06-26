import type { RealtimeEventType } from "../realtime/eventTypes.js";
import {
  companyRoom,
  orderRoom,
  resolveCompanyId,
} from "../realtime/rooms.js";
import type { OutboxEnvelopePayload } from "./types.js";

type BookingRow = Record<string, unknown> & { id?: string; status?: string };

function bookingsMap(hotelPms: unknown): Map<string, BookingRow> {
  const map = new Map<string, BookingRow>();
  if (!hotelPms || typeof hotelPms !== "object") return map;
  const list = (hotelPms as { bookings?: unknown }).bookings;
  if (!Array.isArray(list)) return map;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const id = String((raw as BookingRow).id || "").trim();
    if (!id) continue;
    map.set(id, raw as BookingRow);
  }
  return map;
}

function stableJson(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return "";
  }
}

function changedFields(prev: BookingRow, next: BookingRow): string[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const out: string[] = [];
  for (const k of keys) {
    if (k === "id") continue;
    if (stableJson(prev[k]) !== stableJson(next[k])) out.push(k);
  }
  return out;
}

/**
 * So sánh hotelPms trước/sau PUT — sinh outbox events cho booking thay đổi.
 * bookingId map tới room order:{bookingId}.
 */
export function diffHotelPmsBookingOutboxEvents(
  prevHotelPms: unknown,
  nextHotelPms: unknown,
  companyId: string,
  sourceClientId?: string,
): OutboxEnvelopePayload[] {
  const cid = resolveCompanyId(companyId);
  const prev = bookingsMap(prevHotelPms);
  const next = bookingsMap(nextHotelPms);
  const events: OutboxEnvelopePayload[] = [];

  for (const [orderId, booking] of next) {
    const old = prev.get(orderId);
    const status = String(booking.status || "active");
    if (!old) {
      events.push(buildOrderEvent("order_created", orderId, cid, status, [], sourceClientId));
      continue;
    }
    if (stableJson(old) !== stableJson(booking)) {
      const fields = changedFields(old, booking);
      events.push(buildOrderEvent("order_updated", orderId, cid, status, fields, sourceClientId));
    }
  }

  for (const [orderId, old] of prev) {
    if (!next.has(orderId)) {
      const status = String(old.status || "removed");
      events.push(
        buildOrderEvent("order_updated", orderId, cid, status, ["deleted"], sourceClientId),
      );
    }
  }

  return events;
}

function buildOrderEvent(
  type: RealtimeEventType,
  orderId: string,
  companyId: string,
  status: string,
  changedFields: string[],
  sourceClientId?: string,
): OutboxEnvelopePayload {
  const targetRooms = [orderRoom(orderId), companyRoom(companyId)];
  const businessPayload: Record<string, unknown> = {
    orderId,
    companyId,
    status,
  };
  if (changedFields.length > 0) businessPayload.changedFields = changedFields;
  if (sourceClientId?.trim()) businessPayload.sourceClientId = sourceClientId.trim();

  return {
    type,
    targetRooms,
    companyId,
    payload: businessPayload,
    sourceClientId,
  };
}
