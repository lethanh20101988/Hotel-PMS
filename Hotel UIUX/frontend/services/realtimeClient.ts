/**
 * Thin client cho WS /ws/state — join room, nhận event granular (order_updated, …).
 * Không tạo connection riêng; store.ts bind socket khi connect.
 */

export type RealtimeWireMessage = {
  type?: string;
  event?: string;
  eventId?: string;
  at?: number;
  companyId?: string;
  revision?: number;
  kinds?: string[];
  sourceClientId?: string;
  payload?: {
    orderId?: string;
    companyId?: string;
    status?: string;
    changedFields?: string[];
    driverId?: string;
    zoneId?: string;
    [key: string]: unknown;
  };
  rooms?: string[];
  all?: string[];
};

const joinedRooms = new Set<string>();
let wsRef: WebSocket | null = null;

/** Idempotency — ignore duplicate eventId (Redis/at-least-once / worker retry). */
const SEEN_EVENT_MAX = 500;
const seenEventIds: string[] = [];
const seenEventSet = new Set<string>();

function rememberEventId(eventId: string): boolean {
  const id = String(eventId || '').trim();
  if (!id) return true;
  if (seenEventSet.has(id)) return false;
  seenEventSet.add(id);
  seenEventIds.push(id);
  if (seenEventIds.length > SEEN_EVENT_MAX) {
    const old = seenEventIds.shift();
    if (old) seenEventSet.delete(old);
  }
  return true;
}

export function orderRoomForBooking(bookingId: string): string {
  return `order:${String(bookingId).trim()}`;
}

function sendJson(payload: unknown) {
  if (!wsRef || wsRef.readyState !== WebSocket.OPEN) return;
  try {
    wsRef.send(JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function resyncJoinedRooms() {
  if (joinedRooms.size === 0) return;
  sendJson({ type: 'join', rooms: [...joinedRooms] });
}

export function bindRealtimeWebSocket(ws: WebSocket | null) {
  wsRef = ws;
  if (ws) {
    ws.addEventListener('open', () => resyncJoinedRooms());
    if (ws.readyState === WebSocket.OPEN) resyncJoinedRooms();
  }
}

export function joinRealtimeRooms(rooms: string[]) {
  const toJoin = rooms.map((r) => String(r || '').trim()).filter(Boolean);
  for (const room of toJoin) joinedRooms.add(room);
  sendJson({ type: 'join', rooms: toJoin });
}

export function leaveRealtimeRooms(rooms: string[]) {
  const toLeave = rooms.map((r) => String(r || '').trim()).filter(Boolean);
  for (const room of toLeave) joinedRooms.delete(room);
  sendJson({ type: 'leave', rooms: toLeave });
}

/**
 * Xử lý message không phải state-sync (revision/kinds).
 * Trả true nếu đã consume (không gọi handleRemoteStateSignal).
 */
export function dispatchRealtimeWireMessage(data: RealtimeWireMessage): boolean {
  if (data.type === 'joined' || data.type === 'left' || data.type === 'pong') return true;
  if (data.type === 'error' && data.event === undefined) return true;

  const eventName = data.event;
  if (eventName === 'state_changed') {
    if (data.eventId && !rememberEventId(data.eventId)) return true;
    return false;
  }
  if (eventName) {
    if (data.eventId && !rememberEventId(data.eventId)) return true;
    window.dispatchEvent(
      new CustomEvent('vtr:realtime-event', {
        detail: {
          eventId: data.eventId,
          event: eventName,
          at: data.at,
          companyId: data.companyId,
          payload: data.payload ?? {},
        },
      }),
    );
    return true;
  }

  return false;
}
