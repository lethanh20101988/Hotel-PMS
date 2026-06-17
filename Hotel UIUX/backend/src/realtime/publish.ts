import {
  companyRoom,
  driverRoom,
  orderRoom,
  userRoom,
  zoneRoom,
  resolveCompanyId,
} from "./rooms.js";
import { realtimeHub } from "./realtimeHub.js";
import type {
  DriverLocationPayload,
  NotificationCreatedPayload,
  OrderAssignedPayload,
  OrderCreatedPayload,
  OrderUpdatedPayload,
  StateChangedPayload,
} from "./eventTypes.js";

export function targetRoomsForOrderCreated(p: OrderCreatedPayload): string[] {
  const rooms = [orderRoom(p.orderId), companyRoom(p.companyId)];
  if (p.zoneId) rooms.push(zoneRoom(p.zoneId));
  if (p.driverId) rooms.push(driverRoom(p.driverId));
  return [...new Set(rooms)];
}

export function targetRoomsForOrderUpdated(p: OrderUpdatedPayload): string[] {
  return [orderRoom(p.orderId), companyRoom(p.companyId)];
}

export function targetRoomsForOrderAssigned(p: OrderAssignedPayload): string[] {
  const rooms = [orderRoom(p.orderId), driverRoom(p.driverId), companyRoom(p.companyId)];
  if (p.zoneId) rooms.push(zoneRoom(p.zoneId));
  return [...new Set(rooms)];
}

export function targetRoomsForDriverLocation(p: DriverLocationPayload): string[] {
  const rooms = [driverRoom(p.driverId), companyRoom(p.companyId)];
  if (p.zoneId) rooms.push(zoneRoom(p.zoneId));
  return [...new Set(rooms)];
}

export function targetRoomsForNotification(p: NotificationCreatedPayload): string[] {
  const rooms = [companyRoom(p.companyId)];
  if (p.userId) rooms.push(userRoom(p.userId));
  return rooms;
}

export function targetRoomsForStateChanged(companyId?: string | null): string[] {
  return [companyRoom(resolveCompanyId(companyId))];
}

export async function publishStateChanged(
  payload: StateChangedPayload,
  companyId?: string | null,
) {
  const cid = resolveCompanyId(companyId);
  return realtimeHub.publishLocal({
    type: "state_changed",
    targetRooms: targetRoomsForStateChanged(cid),
    companyId: cid,
    payload,
  });
}

export async function publishOrderCreated(payload: OrderCreatedPayload) {
  return realtimeHub.publishLocal({
    type: "order_created",
    targetRooms: targetRoomsForOrderCreated(payload),
    companyId: payload.companyId,
    payload,
  });
}

export async function publishOrderUpdated(payload: OrderUpdatedPayload) {
  return realtimeHub.publishLocal({
    type: "order_updated",
    targetRooms: targetRoomsForOrderUpdated(payload),
    companyId: payload.companyId,
    payload,
  });
}

export async function publishOrderAssigned(payload: OrderAssignedPayload) {
  return realtimeHub.publishLocal({
    type: "order_assigned",
    targetRooms: targetRoomsForOrderAssigned(payload),
    companyId: payload.companyId,
    payload,
  });
}

export async function publishDriverLocationUpdated(payload: DriverLocationPayload) {
  return realtimeHub.publishLocal({
    type: "driver_location_updated",
    targetRooms: targetRoomsForDriverLocation(payload),
    companyId: payload.companyId,
    payload,
  });
}

export async function publishNotificationCreated(payload: NotificationCreatedPayload) {
  return realtimeHub.publishLocal({
    type: "notification_created",
    targetRooms: targetRoomsForNotification(payload),
    companyId: payload.companyId,
    payload,
  });
}
