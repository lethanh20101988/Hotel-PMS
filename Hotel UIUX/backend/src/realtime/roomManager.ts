import { WebSocket } from "ws";
import { parseRoomKey, resolveCompanyId } from "./rooms.js";

export type WsClientRole = "user" | "driver" | "admin" | "super_admin";

export type WsClientMeta = {
  ws: WebSocket;
  connectionId: string;
  userId: string;
  companyId: string | null;
  role: WsClientRole;
  isSuperAdmin: boolean;
  isAlive: boolean;
  rooms: Set<string>;
  messageTimestamps: number[];
};

export type RoomJoinPolicy = {
  canJoinRoom: (client: WsClientMeta, room: string) => boolean;
};

const DEFAULT_JOINABLE_KINDS = new Set(["order", "zone", "driver"]);

/** Mặc định: user chỉ join order/zone/driver trong cùng company (hoặc super_admin). */
export function defaultJoinPolicy(): RoomJoinPolicy {
  return {
    canJoinRoom(client, room) {
      if (client.isSuperAdmin) return true;
      const parsed = parseRoomKey(room);
      if (!parsed) return false;
      if (parsed.kind === "user" && parsed.id === client.userId) return true;
      if (parsed.kind === "driver" && client.role === "driver" && parsed.id === client.userId) return true;
      // company room: cho phép join đúng company của client (fallback default-company).
      // Đây là điều kiện để client nhận state_changed realtime giữa nhiều máy.
      const ownCompany = resolveCompanyId(client.companyId);
      if (parsed.kind === "company") return parsed.id === ownCompany;
      if (!DEFAULT_JOINABLE_KINDS.has(parsed.kind)) return false;
      // order/zone/driver: client phải đã ở company room — kiểm tra company membership qua API khi scale
      return client.rooms.has(`company:${ownCompany}`);
    },
  };
}

export class RoomManager {
  private clients = new Set<WsClientMeta>();
  private roomMembers = new Map<string, Set<WsClientMeta>>();
  private policy: RoomJoinPolicy;

  constructor(policy: RoomJoinPolicy = defaultJoinPolicy()) {
    this.policy = policy;
  }

  register(client: WsClientMeta) {
    this.clients.add(client);
  }

  unregister(client: WsClientMeta) {
    this.clients.delete(client);
    for (const room of client.rooms) {
      const members = this.roomMembers.get(room);
      if (members) {
        members.delete(client);
        if (members.size === 0) this.roomMembers.delete(room);
      }
    }
    client.rooms.clear();
  }

  join(client: WsClientMeta, room: string): boolean {
    if (!this.policy.canJoinRoom(client, room)) return false;
    if (!client.rooms.has(room)) {
      client.rooms.add(room);
      let members = this.roomMembers.get(room);
      if (!members) {
        members = new Set();
        this.roomMembers.set(room, members);
      }
      members.add(client);
    }
    return true;
  }

  joinMany(client: WsClientMeta, rooms: string[]): string[] {
    const joined: string[] = [];
    for (const room of rooms) {
      if (this.join(client, room)) joined.push(room);
    }
    return joined;
  }

  leave(client: WsClientMeta, room: string) {
    if (!client.rooms.has(room)) return;
    client.rooms.delete(room);
    const members = this.roomMembers.get(room);
    if (members) {
      members.delete(client);
      if (members.size === 0) this.roomMembers.delete(room);
    }
  }

  /** Emit tới rooms cụ thể — không global broadcast. */
  emitToRooms(rooms: string[], payload: string, opts?: { skipConnectionId?: string }) {
    const delivered = new Set<WsClientMeta>();
    for (const room of rooms) {
      const members = this.roomMembers.get(room);
      if (!members) continue;
      for (const client of members) {
        if (opts?.skipConnectionId && client.connectionId === opts.skipConnectionId) continue;
        delivered.add(client);
      }
    }
  // super_admin nhận mọi event nếu đang connected (ops dashboard)
    for (const client of this.clients) {
      if (client.isSuperAdmin) delivered.add(client);
    }
    for (const client of delivered) {
      this.sendRaw(client, payload);
    }
  }

  sendRaw(client: WsClientMeta, payload: string) {
    try {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(payload);
      } else {
        this.unregister(client);
      }
    } catch {
      this.unregister(client);
      try {
        client.ws.terminate();
      } catch {}
    }
  }

  heartbeatSweep() {
    for (const client of this.clients) {
      if (client.ws.readyState !== client.ws.OPEN) {
        this.unregister(client);
        continue;
      }
      if (!client.isAlive) {
        this.unregister(client);
        try {
          client.ws.terminate();
        } catch {}
        continue;
      }
      client.isAlive = false;
      try {
        client.ws.ping();
      } catch {
        this.unregister(client);
      }
    }
  }

  getStats() {
    const roomCounts: Record<string, number> = {};
    for (const [room, members] of this.roomMembers) {
      roomCounts[room] = members.size;
    }
    return {
      connections: this.clients.size,
      rooms: this.roomMembers.size,
      roomCounts,
    };
  }
}
