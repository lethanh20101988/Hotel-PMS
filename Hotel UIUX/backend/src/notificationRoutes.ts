import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";

type Deps = {
  prisma: PrismaClient;
  requireAuth: (req: any, res: any, next: any) => void;
};

export function registerNotificationRoutes(app: Express, deps: Deps) {
  const { prisma, requireAuth } = deps;

  /** Thông báo mới sau mốc thời gian (polling toast) — ASC */
  app.get("/api/notifications", requireAuth, async (req, res) => {
    try {
      const afterRaw = typeof req.query.after === "string" ? req.query.after : "";
      const after = afterRaw ? new Date(afterRaw) : null;
      if (after && Number.isNaN(after.getTime())) {
        return res.status(400).json({ error: "Invalid after" });
      }
      const rows = await prisma.notification.findMany({
        where: after ? { createdAt: { gt: after } } : undefined,
        orderBy: { createdAt: "asc" },
        take: 40,
      });
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "list failed" });
    }
  });

  app.get("/api/notifications/recent", requireAuth, async (_req, res) => {
    try {
      const rows = await prisma.notification.findMany({
        orderBy: { createdAt: "desc" },
        take: 30,
      });
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "recent failed" });
    }
  });

  app.get("/api/notifications/summary", requireAuth, async (_req, res) => {
    try {
      const unreadNotifications = await prisma.notification.count({
        where: { readAt: null },
      });

      res.json({
        openBatches: 0,
        recentNew: 0,
        batchesWithErrors: 0,
        batchesReadyToCommit: 0,
        batchesNeedingAction: 0,
        unreadNotifications,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "summary failed" });
    }
  });

  app.patch("/api/notifications/:id/read", requireAuth, async (req, res) => {
    try {
      const row = await prisma.notification.update({
        where: { id: req.params.id },
        data: { readAt: new Date() },
      });
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "read failed" });
    }
  });

  app.post("/api/notifications/read-all", requireAuth, async (_req, res) => {
    try {
      const now = new Date();
      await prisma.notification.updateMany({
        where: { readAt: null },
        data: { readAt: now },
      });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "read-all failed" });
    }
  });
}
