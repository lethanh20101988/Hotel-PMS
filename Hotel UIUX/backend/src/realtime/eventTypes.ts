import type { EntityLifecycleMeta, StateChangeKind } from "./stateTypes.js";

/** Redis Pub/Sub envelope — một format cho mọi instance. */
export type RealtimeEventType =
  | "state_changed"
  | "order_created"
  | "order_updated"
  | "order_assigned"
  | "driver_location_updated"
  | "notification_created";

export type RealtimeEnvelope<TPayload = unknown> = {
  id: string;
  type: RealtimeEventType;
  at: number;
  originInstanceId: string;
  /** Room keys — chỉ client đã join nhận message (super_admin nhận tất cả). */
  targetRooms: string[];
  companyId?: string;
  payload: TPayload;
};

export type StateChangedPayload = {
  revision: number;
  dataVersion?: number;
  sourceClientId?: string;
  kinds: StateChangeKind[];
  entity?: EntityLifecycleMeta;
  state?: unknown;
};

export type OrderCreatedPayload = {
  orderId: string;
  companyId: string;
  zoneId?: string;
  driverId?: string;
  status: string;
  summary?: string;
};

export type OrderUpdatedPayload = {
  orderId: string;
  companyId: string;
  status: string;
  changedFields?: string[];
};

export type OrderAssignedPayload = {
  orderId: string;
  companyId: string;
  driverId: string;
  zoneId?: string;
};

export type DriverLocationPayload = {
  driverId: string;
  companyId: string;
  zoneId?: string;
  lat: number;
  lng: number;
  at: number;
};

export type NotificationCreatedPayload = {
  notificationId: string;
  companyId: string;
  userId?: string;
  kind: string;
  title: string;
};

/** Redis channel prefix — subscribe pattern `sme-hotel:bus:*` hoặc single channel. */
export const REALTIME_BUS_CHANNEL = "sme-hotel:bus";

export function eventChannelForType(type: RealtimeEventType): string {
  return `${REALTIME_BUS_CHANNEL}:${type}`;
}

export const ALL_EVENT_CHANNELS: RealtimeEventType[] = [
  "state_changed",
  "order_created",
  "order_updated",
  "order_assigned",
  "driver_location_updated",
  "notification_created",
];
