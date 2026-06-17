import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import { getRealtimeMonitorSnapshot } from "../stateSync.js";
import {
  publishDriverLocationUpdated,
  publishOrderAssigned,
  publishOrderCreated,
  publishOrderUpdated,
} from "./publish.js";
import { resolveCompanyId } from "./rooms.js";

type AuthedUser = {
  id: string;
  role: string;
  companyId: string | null;
};

export function registerRealtimeRoutes(
  app: Express,
  deps: {
    requireAuth: (req: any, res: any, next: any) => void;
    checkSuperAdmin: (req: any, res: any, next: any) => void;
    prisma?: PrismaClient;
  },
) {
  app.get("/api/realtime/stats", deps.requireAuth, deps.checkSuperAdmin, (_req, res) => {
    res.json(getRealtimeMonitorSnapshot());
  });

  if (deps.prisma) {
    app.get("/api/realtime/outbox/stats", deps.requireAuth, deps.checkSuperAdmin, async (_req, res) => {
      const prisma = deps.prisma!;
      const [pending, processing, sent, failed] = await Promise.all([
        prisma.eventOutbox.count({ where: { status: "pending" } }),
        prisma.eventOutbox.count({ where: { status: "processing" } }),
        prisma.eventOutbox.count({ where: { status: "sent" } }),
        prisma.eventOutbox.count({ where: { status: "failed" } }),
      ]);
      res.json({
        pending,
        processing,
        sent,
        failed,
        realtime: getRealtimeMonitorSnapshot(),
      });
    });
  }

  /** Stub API — hotel PMS / logistics gọi khi có booking/order thật. */
  app.post("/api/realtime/events/order-created", deps.requireAuth, async (req: any, res) => {
    const u = req.user as AuthedUser;
    const companyId = resolveCompanyId(u.companyId);
    const body = req.body as {
      orderId?: string;
      zoneId?: string;
      driverId?: string;
      status?: string;
      summary?: string;
    };
    if (!body.orderId) return res.status(400).json({ error: "orderId required" });
    const envelope = await publishOrderCreated({
      orderId: body.orderId,
      companyId,
      zoneId: body.zoneId,
      driverId: body.driverId,
      status: body.status || "created",
      summary: body.summary,
    });
    res.json({ ok: true, eventId: envelope.id, targetRooms: envelope.targetRooms });
  });

  app.post("/api/realtime/events/order-updated", deps.requireAuth, async (req: any, res) => {
    const u = req.user as AuthedUser;
    const companyId = resolveCompanyId(u.companyId);
    const body = req.body as { orderId?: string; status?: string; changedFields?: string[] };
    if (!body.orderId) return res.status(400).json({ error: "orderId required" });
    const envelope = await publishOrderUpdated({
      orderId: body.orderId,
      companyId,
      status: body.status || "updated",
      changedFields: body.changedFields,
    });
    res.json({ ok: true, eventId: envelope.id, targetRooms: envelope.targetRooms });
  });

  app.post("/api/realtime/events/order-assigned", deps.requireAuth, async (req: any, res) => {
    const u = req.user as AuthedUser;
    const companyId = resolveCompanyId(u.companyId);
    const body = req.body as { orderId?: string; driverId?: string; zoneId?: string };
    if (!body.orderId || !body.driverId) {
      return res.status(400).json({ error: "orderId and driverId required" });
    }
    const envelope = await publishOrderAssigned({
      orderId: body.orderId,
      companyId,
      driverId: body.driverId,
      zoneId: body.zoneId,
    });
    res.json({ ok: true, eventId: envelope.id, targetRooms: envelope.targetRooms });
  });

  app.post("/api/realtime/events/driver-location", deps.requireAuth, async (req: any, res) => {
    const u = req.user as AuthedUser;
    const companyId = resolveCompanyId(u.companyId);
    const body = req.body as { driverId?: string; lat?: number; lng?: number; zoneId?: string };
    if (!body.driverId || body.lat == null || body.lng == null) {
      return res.status(400).json({ error: "driverId, lat, lng required" });
    }
    const envelope = await publishDriverLocationUpdated({
      driverId: body.driverId,
      companyId,
      zoneId: body.zoneId,
      lat: body.lat,
      lng: body.lng,
      at: Date.now(),
    });
    res.json({ ok: true, eventId: envelope.id, targetRooms: envelope.targetRooms });
  });
}
