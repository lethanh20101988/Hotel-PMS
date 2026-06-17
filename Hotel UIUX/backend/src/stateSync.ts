import type { Express, Request } from "express";
import type { IncomingMessage } from "node:http";
import {
  companyRoom,
  DEFAULT_COMPANY_ROOM_ID,
  resolveCompanyId,
  realtimeHub,
  createStateWebSocketServer,
  getPresenceCache,
  getMonitorSnapshot,
  type EntityLifecycleMeta,
  type StateChangeKind,
} from "./realtime/index.js";

export type { StateChangeKind, EntityLifecycleMeta } from "./realtime/stateTypes.js";
export const DEFAULT_STATE_ROOM_ID = DEFAULT_COMPANY_ROOM_ID;

export type StateChangeEvent = {
  revision: number;
  at: number;
  sourceClientId?: string;
  kinds: StateChangeKind[];
  originInstanceId?: string;
  companyId?: string;
  room?: string;
  entity?: EntityLifecycleMeta;
};

type WsAuthUser = {
  id: string;
  companyId: string | null;
  isSuperAdmin: boolean;
};

type AuthResolver = (req: any) => Promise<WsAuthUser | null>;

let revision = 0;
let stateDataVersion = Date.now();

export function companyRoomId(companyId?: string | null): string {
  return companyRoom(companyId);
}

export function resolveEventCompanyId(companyId?: string | null): string {
  return resolveCompanyId(companyId);
}

export function getStateDataVersion(): number {
  return stateDataVersion;
}

export function bumpStateDataVersion(): number {
  stateDataVersion = Math.max(stateDataVersion + 1, Date.now());
  return stateDataVersion;
}

export function getStateRevision(): number {
  return revision;
}

function nextRevision(incoming?: number): number {
  revision = Math.max(revision + 1, Date.now(), Number(incoming || 0));
  return revision;
}

function buildStateChangeEvent(
  rev: number,
  opts: {
    sourceClientId?: string;
    kinds?: StateChangeKind[];
    companyId?: string | null;
    entity?: EntityLifecycleMeta;
  },
): StateChangeEvent {
  const companyId = resolveCompanyId(opts.companyId);
  return {
    revision: rev,
    at: Date.now(),
    sourceClientId: opts.sourceClientId?.trim() || undefined,
    kinds: opts.kinds?.length ? opts.kinds : ["state"],
    companyId,
    room: companyRoom(companyId),
    entity: opts.entity,
  };
}

export function notifyStateChanged(opts?: {
  sourceClientId?: string;
  kinds?: StateChangeKind[];
  companyId?: string | null;
}): StateChangeEvent {
  realtimeHub.wire();
  const rev = nextRevision();
  const event = buildStateChangeEvent(rev, opts ?? {});
  void realtimeHub.publishLocal({
    type: "state_changed",
    targetRooms: [companyRoom(event.companyId!)],
    companyId: event.companyId,
    payload: {
      revision: event.revision,
      sourceClientId: event.sourceClientId,
      kinds: event.kinds,
    },
  });
  return event;
}

export function notifyEntityLifecycle(
  opts: EntityLifecycleMeta & {
    sourceClientId?: string;
    companyId?: string | null;
  },
): StateChangeEvent {
  realtimeHub.wire();
  const rev = nextRevision();
  const event = buildStateChangeEvent(rev, {
    sourceClientId: opts.sourceClientId,
    kinds: ["state"],
    companyId: opts.companyId,
    entity: {
      action: opts.action,
      entityType: opts.entityType,
      entityId: opts.entityId,
      version: opts.version,
      status: opts.status,
      actorUserId: opts.actorUserId,
    },
  });
  void realtimeHub.publishLocal({
    type: "state_changed",
    targetRooms: [companyRoom(event.companyId!)],
    companyId: event.companyId,
    payload: {
      revision: event.revision,
      sourceClientId: event.sourceClientId,
      kinds: event.kinds,
      entity: event.entity,
    },
  });
  return event;
}

function readClientId(req: Request): string | undefined {
  const raw = String(req.headers["x-client-id"] || "").trim();
  return raw || undefined;
}

export function registerStateSyncRoutes(app: Express, deps: { resolveAuth: AuthResolver }) {
  app.get("/api/state/version", async (req, res) => {
    const user = await deps.resolveAuth(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.json({ revision, at: Date.now() });
  });

  return { readClientId };
}

/** @deprecated Use configureRealtimeRedis from realtime/index — giữ tên để không đổi index.ts import. */
export async function configureStateSyncRedis(_deps: {
  publisher: unknown;
  subscriber: unknown;
}) {
  // Wired via configureRealtimeRedis in index.ts
  realtimeHub.wire();
}

export function registerStateSyncWebSocket(deps: { resolveAuth: AuthResolver }) {
  realtimeHub.wire();
  return createStateWebSocketServer({
    roomManager: realtimeHub.roomManager,
    presence: getPresenceCache(),
    resolveAuth: async (req: IncomingMessage) => {
      const authed = await deps.resolveAuth(req as any);
      return authed
        ? { id: authed.id, companyId: authed.companyId, isSuperAdmin: authed.isSuperAdmin }
        : null;
    },
  });
}

export function getRealtimeMonitorSnapshot() {
  return getMonitorSnapshot(realtimeHub.roomManager);
}
