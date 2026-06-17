import type { Express, Request } from "express";
import type { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { notifyStateChanged, DEFAULT_STATE_ROOM_ID } from "./stateSync.js";

const Gtgt01PayloadSchema = z
  .object({
    version: z.number().optional(),
    snapshots: z.array(z.unknown()).optional(),
    baselines: z.record(z.string(), z.unknown()).optional(),
    pl204ByPeriod: z.record(z.string(), z.unknown()).optional(),
    workingDrafts: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export function registerTaxGtgt01Routes(
  app: Express,
  prisma: PrismaClient,
  deps: {
    toPrismaJson: (value: unknown) => Prisma.InputJsonValue;
    readClientId?: (req: Request) => string | undefined;
  }
) {
  /** Đọc giống GET /api/state — không cần JWT (máy cá nhân / dev). */
  app.get("/api/tax/gtgt01/data", async (_req, res) => {
    try {
      const row = await prisma.gtgt01Data.findUnique({ where: { id: 1 } });
      if (!row) return res.json({ payload: null, updatedAt: null });
      return res.json({ payload: row.payload, updatedAt: row.updatedAt.toISOString() });
    } catch (err: any) {
      console.error("[GET /api/tax/gtgt01/data]", err);
      res.status(500).json({ error: "Failed to load GTGT01 data" });
    }
  });

  /** Ghi không bắt buộc JWT — cùng phạm vi với GET (máy đơn / Docker nội bộ); dữ liệu trong SQLite (DATABASE_URL). */
  app.put("/api/tax/gtgt01/data", async (req, res) => {
    try {
      const parsed = Gtgt01PayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid GTGT01 payload", details: parsed.error.flatten() });
      }
      const row = await prisma.gtgt01Data.upsert({
        where: { id: 1 },
        create: { id: 1, payload: deps.toPrismaJson(parsed.data) },
        update: { payload: deps.toPrismaJson(parsed.data) },
      });
      notifyStateChanged({
        sourceClientId: deps.readClientId?.(req),
        kinds: ["tax"],
        companyId: DEFAULT_STATE_ROOM_ID,
      });
      res.json({ ok: true, updatedAt: row.updatedAt.toISOString() });
    } catch (err) {
      console.error("[PUT /api/tax/gtgt01/data]", err);
      res.status(500).json({ error: "Failed to save GTGT01 data" });
    }
  });
}
