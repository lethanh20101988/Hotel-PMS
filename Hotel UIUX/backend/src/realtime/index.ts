export * from "./rooms.js";
export * from "./stateTypes.js";
export * from "./eventTypes.js";
export * from "./roomManager.js";
export * from "./redisEventBus.js";
export * from "./realtimeHub.js";
export * from "./publish.js";
export * from "./presenceCache.js";
export * from "./rateLimiter.js";
export * from "./monitoring.js";
export * from "./wsGateway.js";

import type { RedisClientType } from "redis";
import { realtimeBus } from "./redisEventBus.js";
import { realtimeHub } from "./realtimeHub.js";
import { PresenceCache } from "./presenceCache.js";

let presenceCache: PresenceCache | null = null;

export function getPresenceCache(): PresenceCache | null {
  return presenceCache;
}

/** Wire Redis publisher + subscriber cho multi-instance Docker scale. */
export async function configureRealtimeRedis(clients: {
  publisher: RedisClientType | null;
  subscriber: RedisClientType | null;
}) {
  realtimeHub.wire();
  realtimeBus.setPublisher(clients.publisher);
  presenceCache = clients.publisher ? new PresenceCache(clients.publisher) : null;

  if (!clients.subscriber) {
    console.warn("[realtime] Redis subscriber missing — single-instance mode");
    return;
  }

  clients.subscriber.on("error", (e) => console.warn("[realtime] subscriber error", e));
  clients.subscriber.on("reconnecting", () => {
    console.warn("[realtime] subscriber reconnecting...");
  });

  await realtimeBus.setSubscriber(clients.subscriber);
}

export async function reconnectRealtimeSubscriber(subscriber: RedisClientType) {
  await realtimeBus.resubscribe(subscriber);
}
