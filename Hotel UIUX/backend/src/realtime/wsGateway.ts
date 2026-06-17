import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { defaultRoomsForUser, parseRoomKey } from "./rooms.js";
import type { RoomManager, WsClientMeta, WsClientRole } from "./roomManager.js";
import { MessageRateLimiter } from "./rateLimiter.js";
import type { PresenceCache } from "./presenceCache.js";
import { bumpConnection } from "./monitoring.js";

export type WsAuthUser = {
  id: string;
  companyId: string | null;
  isSuperAdmin: boolean;
  role?: WsClientRole;
};

type AuthResolver = (req: IncomingMessage) => Promise<WsAuthUser | null>;

type WsGatewayDeps = {
  roomManager: RoomManager;
  resolveAuth: AuthResolver;
  presence?: PresenceCache | null;
  rateLimiter?: MessageRateLimiter;
  onConnected?: (client: WsClientMeta) => void;
  onDisconnected?: (client: WsClientMeta) => void;
};

export function createStateWebSocketServer(deps: WsGatewayDeps) {
  const wss = new WebSocketServer({ noServer: true });
  const limiter = deps.rateLimiter ?? new MessageRateLimiter({ maxMessages: 120, windowMs: 60_000 });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const user = await deps.resolveAuth(req).catch(() => null);
    if (!user) {
      try {
        ws.close(1008, "Unauthorized");
      } catch {}
      return;
    }

    const role: WsClientRole = user.isSuperAdmin
      ? "super_admin"
      : user.role ?? "user";

    const client: WsClientMeta = {
      ws,
      connectionId: crypto.randomUUID(),
      userId: user.id,
      companyId: user.companyId,
      role,
      isSuperAdmin: user.isSuperAdmin,
      isAlive: true,
      rooms: new Set(),
      messageTimestamps: [],
    };

    deps.roomManager.register(client);
    bumpConnection();
    const defaults = defaultRoomsForUser({
      userId: user.id,
      companyId: user.companyId,
      isSuperAdmin: user.isSuperAdmin,
    });
    deps.roomManager.joinMany(client, defaults);

    if (deps.presence) {
      if (role === "driver") await deps.presence.markDriverOnline(user.id);
      else await deps.presence.markUserOnline(user.id);
    }

    deps.onConnected?.(client);

    ws.on("pong", () => {
      client.isAlive = true;
      if (deps.presence) {
        if (role === "driver") void deps.presence.markDriverOnline(user.id);
        else void deps.presence.markUserOnline(user.id);
      }
    });

    ws.on("message", (raw) => {
      if (!limiter.allow(client.messageTimestamps)) {
        deps.roomManager.sendRaw(
          client,
          JSON.stringify({ type: "error", error: "rate_limited" }),
        );
        return;
      }
      try {
        const msg = JSON.parse(String(raw || "{}")) as {
          type?: string;
          action?: string;
          rooms?: string[];
        };
        if (msg.type === "ping" || msg.action === "ping") {
          deps.roomManager.sendRaw(client, JSON.stringify({ type: "pong", at: Date.now() }));
          return;
        }
        if (msg.type === "join" || msg.action === "join") {
          const rooms = Array.isArray(msg.rooms) ? msg.rooms : [];
          const joined = deps.roomManager.joinMany(client, rooms.filter((r) => parseRoomKey(r)));
          deps.roomManager.sendRaw(
            client,
            JSON.stringify({ type: "joined", rooms: joined, all: [...client.rooms] }),
          );
          return;
        }
        if (msg.type === "leave" || msg.action === "leave") {
          const rooms = Array.isArray(msg.rooms) ? msg.rooms : [];
          for (const room of rooms) deps.roomManager.leave(client, room);
          deps.roomManager.sendRaw(
            client,
            JSON.stringify({ type: "left", rooms, all: [...client.rooms] }),
          );
        }
      } catch {
        // ignore malformed client messages
      }
    });

    ws.on("close", () => {
      deps.roomManager.unregister(client);
      if (deps.presence) {
        if (role === "driver") void deps.presence.markDriverOffline(user.id);
        else void deps.presence.markUserOffline(user.id);
      }
      deps.onDisconnected?.(client);
    });

    ws.on("error", () => {
      deps.roomManager.unregister(client);
      try {
        ws.terminate();
      } catch {}
    });

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          revision: Date.now(),
          at: Date.now(),
          kinds: ["connected"],
          companyId: user.companyId ?? undefined,
          rooms: [...client.rooms],
          connectionId: client.connectionId,
        }),
      );
    }
  });

  const heartbeat = setInterval(() => deps.roomManager.heartbeatSweep(), 15_000);
  wss.on("close", () => clearInterval(heartbeat));

  return wss;
}
