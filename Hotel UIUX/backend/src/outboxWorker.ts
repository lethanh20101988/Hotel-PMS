/**
 * Event Dispatcher — standalone worker process.
 * Docker: service `event-dispatcher` → docker-entrypoint-worker.sh
 */
import { PrismaClient } from "@prisma/client";
import { createClient, type RedisClientType } from "redis";
import { realtimeBus } from "./realtime/redisEventBus.js";
import { waitForSchemaReady } from "./outbox/schemaReady.js";
import { startOutboxWorker } from "./outbox/worker.js";

const prisma = new PrismaClient();
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

let redisPublisher: RedisClientType | null = null;

async function connectRedisPublisher(): Promise<void> {
  if (redisPublisher?.isOpen) return;

  const client = createClient({
    url: REDIS_URL,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
    },
  }) as RedisClientType;

  client.on("error", (e) => console.warn("[outbox-worker] redis error", e));
  client.on("reconnecting", () => console.warn("[outbox-worker] redis reconnecting..."));
  client.on("ready", () => {
    console.log("[outbox-worker] redis ready");
    realtimeBus.setPublisher(client);
  });

  await client.connect();
  redisPublisher = client;
  realtimeBus.setPublisher(client);
}

async function main() {
  console.log("[outbox-worker] Event Dispatcher starting...");

  const schema = await waitForSchemaReady(prisma);
  if (!schema.ok) {
    console.error(`[outbox-worker] FATAL: ${schema.reason ?? "schema not ready"}`);
    process.exit(1);
  }

  await connectRedisPublisher();

  const worker = startOutboxWorker({
    prisma,
    ensurePublisher: connectRedisPublisher,
  });

  const shutdown = async () => {
    console.log("[outbox-worker] shutting down...");
    worker.stop();
    await prisma.$disconnect();
    if (redisPublisher?.isOpen) await redisPublisher.quit();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("[outbox-worker] fatal:", err);
  process.exit(1);
});
