import type { RoomManager } from "./roomManager.js";

export type RealtimeMonitor = {
  instanceId: string;
  startedAt: number;
  connectionsTotal: number;
  messagesPublished: number;
  messagesReceived: number;
  messagesDelivered: number;
  publishFailures: number;
  lastRedisReconnectAt: number | null;
  outboxPolls: number;
  outboxDispatched: number;
  outboxDispatchFailures: number;
  outboxRequeued: number;
  dispatchLatencyMsAvg: number;
  dispatchLatencySamples: number;
};

let monitor: RealtimeMonitor = {
  instanceId: "",
  startedAt: Date.now(),
  connectionsTotal: 0,
  messagesPublished: 0,
  messagesReceived: 0,
  messagesDelivered: 0,
  publishFailures: 0,
  lastRedisReconnectAt: null,
  outboxPolls: 0,
  outboxDispatched: 0,
  outboxDispatchFailures: 0,
  outboxRequeued: 0,
  dispatchLatencyMsAvg: 0,
  dispatchLatencySamples: 0,
};

export function initMonitor(instanceId: string) {
  monitor.instanceId = instanceId;
  monitor.startedAt = Date.now();
}

export function bumpPublished() {
  monitor.messagesPublished += 1;
}
export function bumpReceived() {
  monitor.messagesReceived += 1;
}
export function bumpDelivered(count = 1) {
  monitor.messagesDelivered += count;
}
export function bumpPublishFailure() {
  monitor.publishFailures += 1;
}
export function bumpConnection() {
  monitor.connectionsTotal += 1;
}
export function markRedisReconnect() {
  monitor.lastRedisReconnectAt = Date.now();
}

export function bumpOutboxPoll() {
  monitor.outboxPolls += 1;
}
export function bumpOutboxDispatched() {
  monitor.outboxDispatched += 1;
}
export function bumpOutboxDispatchFailure() {
  monitor.outboxDispatchFailures += 1;
}
export function bumpOutboxRequeued() {
  monitor.outboxRequeued += 1;
}

export function recordDispatchLatency(ms: number) {
  const n = monitor.dispatchLatencySamples + 1;
  monitor.dispatchLatencyMsAvg =
    (monitor.dispatchLatencyMsAvg * monitor.dispatchLatencySamples + ms) / n;
  monitor.dispatchLatencySamples = n;
}

export function getMonitorSnapshot(roomManager?: RoomManager) {
  const roomStats = roomManager?.getStats();
  const uptimeSec = (Date.now() - monitor.startedAt) / 1000;
  const eventsPerSec =
    uptimeSec > 0 ? Math.round((monitor.messagesPublished / uptimeSec) * 100) / 100 : 0;

  return {
    ...monitor,
    uptimeMs: Date.now() - monitor.startedAt,
    eventsPerSec,
    activeConnections: roomStats?.connections ?? 0,
    activeRooms: roomStats?.rooms ?? 0,
    memoryMb: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10,
    cpu: process.cpuUsage(),
  };
}
