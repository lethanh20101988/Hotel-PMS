import crypto from "node:crypto";
import type { RedisClientType } from "redis";
import {
  ALL_EVENT_CHANNELS,
  eventChannelForType,
  type RealtimeEnvelope,
  type RealtimeEventType,
} from "./eventTypes.js";
import { bumpPublishFailure, bumpPublished, bumpReceived, markRedisReconnect } from "./monitoring.js";

export type RedisPublisher = Pick<RedisClientType, "publish">;
export type RedisSubscriber = Pick<RedisClientType, "subscribe" | "pSubscribe">;

const MAX_PUBLISH_RETRIES = 3;

export class RedisEventBus {
  private readonly instanceId = crypto.randomUUID();
  private publisher: RedisPublisher | null = null;
  private subscriber: RedisSubscriber | null = null;
  private handlers: Array<(envelope: RealtimeEnvelope) => void> = [];
  private subscribed = false;

  getInstanceId(): string {
    return this.instanceId;
  }

  setPublisher(publisher: RedisPublisher | null) {
    this.publisher = publisher;
  }

  async setSubscriber(subscriber: RedisSubscriber | null) {
    this.subscriber = subscriber;
    if (!subscriber || this.subscribed) return;
    const channels = ALL_EVENT_CHANNELS.map((t) => eventChannelForType(t));
    for (const ch of channels) {
      await subscriber.subscribe(ch, (message) => {
        this.handleMessage(message);
      });
    }
    this.subscribed = true;
    console.log(`[realtime-bus] subscribed ${channels.length} channels`);
  }

  onEvent(handler: (envelope: RealtimeEnvelope) => void) {
    this.handlers.push(handler);
  }

  private handleMessage(raw: string) {
    try {
      const envelope = JSON.parse(raw) as RealtimeEnvelope;
      if (!envelope?.type || !envelope.id) return;
      if (envelope.originInstanceId === this.instanceId) return;
      bumpReceived();
      for (const h of this.handlers) h(envelope);
    } catch (err) {
      console.warn("[realtime-bus] invalid message:", err);
    }
  }

  async publish<T>(envelope: Omit<RealtimeEnvelope<T>, "id" | "at" | "originInstanceId">): Promise<RealtimeEnvelope<T>> {
    return this.publishWithId(crypto.randomUUID(), envelope);
  }

  /** Publish với id ổn định (outbox row id) — idempotent trên client. */
  async publishWithId<T>(
    eventId: string,
    envelope: Omit<RealtimeEnvelope<T>, "id" | "at" | "originInstanceId">,
  ): Promise<RealtimeEnvelope<T>> {
    const full: RealtimeEnvelope<T> = {
      ...envelope,
      id: eventId,
      at: Date.now(),
      originInstanceId: this.instanceId,
    };
    const channel = eventChannelForType(full.type);
    const body = JSON.stringify(full);

    if (!this.publisher) {
      bumpPublished();
      return full;
    }

    let attempt = 0;
    while (attempt < MAX_PUBLISH_RETRIES) {
      try {
        await this.publisher.publish(channel, body);
        bumpPublished();
        return full;
      } catch (err) {
        attempt += 1;
        bumpPublishFailure();
        console.warn(`[realtime-bus] publish retry ${attempt}/${MAX_PUBLISH_RETRIES}:`, err);
        await sleep(50 * attempt);
      }
    }
    throw new Error(`Failed to publish ${full.type} after ${MAX_PUBLISH_RETRIES} attempts`);
  }

  /** Gọi khi Redis client reconnect. */
  async resubscribe(subscriber: RedisSubscriber) {
    this.subscribed = false;
    markRedisReconnect();
    await this.setSubscriber(subscriber);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Singleton bus — dùng xuyên suốt app. */
export const realtimeBus = new RedisEventBus();
