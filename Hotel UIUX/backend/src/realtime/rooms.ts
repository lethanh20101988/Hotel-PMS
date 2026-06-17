/** Granular room keys — tránh broadcast toàn company khi không cần. */

export type RoomKind = "company" | "user" | "driver" | "order" | "zone" | "session";

export const DEFAULT_COMPANY_ROOM_ID = "default-company";

export function roomKey(kind: RoomKind, id: string): string {
  const trimmed = String(id || "").trim();
  if (!trimmed) throw new Error(`Invalid room id for kind ${kind}`);
  return `${kind}:${trimmed}`;
}

export function companyRoom(companyId?: string | null): string {
  const id = String(companyId || DEFAULT_COMPANY_ROOM_ID).trim() || DEFAULT_COMPANY_ROOM_ID;
  return roomKey("company", id);
}

export function userRoom(userId: string): string {
  return roomKey("user", userId);
}

export function driverRoom(driverId: string): string {
  return roomKey("driver", driverId);
}

export function orderRoom(orderId: string): string {
  return roomKey("order", orderId);
}

export function zoneRoom(zoneId: string): string {
  return roomKey("zone", zoneId);
}

export function sessionRoom(sessionId: string): string {
  return roomKey("session", sessionId);
}

export function parseRoomKey(key: string): { kind: RoomKind; id: string } | null {
  const m = /^([a-z]+):(.+)$/.exec(String(key || "").trim());
  if (!m) return null;
  const kind = m[1] as RoomKind;
  if (!["company", "user", "driver", "order", "zone", "session"].includes(kind)) return null;
  return { kind, id: m[2] };
}

export function resolveCompanyId(companyId?: string | null): string {
  const id = String(companyId || DEFAULT_COMPANY_ROOM_ID).trim();
  return id || DEFAULT_COMPANY_ROOM_ID;
}

/** Rooms mặc định khi user kết nối WS (không join order/driver cho đến khi cần). */
export function defaultRoomsForUser(opts: {
  userId: string;
  companyId: string | null;
  isSuperAdmin: boolean;
}): string[] {
  // LUÔN join company room (fallback default-company) để nhận state_changed realtime.
  // state_changed được phát tới company:{companyId} nên client buộc phải ở room này.
  return [userRoom(opts.userId), companyRoom(opts.companyId)];
}
