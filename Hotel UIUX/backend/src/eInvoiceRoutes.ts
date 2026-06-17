import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";
import multer from "multer";
import { z } from "zod";
import type { TaxXmlPipelinePayload } from "./eInvoiceTypes.js";
import {
  answerInvoiceChat,
  classifyEInvoice,
  createFileReceivedNotification,
  findBatchByRawXmlHash,
  ingestTaxEInvoiceXml,
  suggestJournalText,
} from "./eInvoiceService.js";

type Deps = {
  prisma: PrismaClient;
  requireAuth: (req: any, res: any, next: any) => void;
};

const xmlUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const n = String(file.originalname || "").toLowerCase();
    if (!n.endsWith(".xml")) {
      cb(new Error("Chỉ chấp nhận file .xml"));
      return;
    }
    cb(null, true);
  },
});

function incomingTaxXmlDir(): string {
  const base = process.env.INVOICE_INCOMING_DIR || path.join(process.cwd(), "invoice-incoming");
  return path.join(base, "tax-einvoice-xml");
}

function isTaxXmlPayload(p: unknown): p is TaxXmlPipelinePayload {
  return (
    typeof p === "object" &&
    p !== null &&
    (p as TaxXmlPipelinePayload).version === 2 &&
    (p as TaxXmlPipelinePayload).pipeline === "TAX_XML"
  );
}

async function listTaxXmlBatches(prisma: PrismaClient) {
  const rows = await prisma.invoiceImportBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.filter((r) => isTaxXmlPayload(r.payload));
}

export function registerEInvoiceRoutes(app: Express, deps: Deps) {
  const { prisma, requireAuth } = deps;

  app.get("/api/e-invoice/config", requireAuth, async (_req, res) => {
    const dir = incomingTaxXmlDir();
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {}
    res.json({
      incomingDir: dir,
      hostHint: process.env.INVOICE_INCOMING_HOST_PATH || "",
      pdfNote: "PDF: tích hợp sau (cần thư viện đọc PDF). Hiện hỗ trợ XML từ cổng TCT.",
    });
  });

  app.get("/api/e-invoice/batches", requireAuth, async (_req, res) => {
    try {
      const batches = await listTaxXmlBatches(prisma);
      res.json(batches);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "list failed" });
    }
  });

  app.get("/api/e-invoice/batches/:id", requireAuth, async (req, res) => {
    try {
      const row = await prisma.invoiceImportBatch.findUnique({ where: { id: req.params.id } });
      if (!row || !isTaxXmlPayload(row.payload)) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "get failed" });
    }
  });

  app.delete("/api/e-invoice/batches/:id", requireAuth, async (req, res) => {
    try {
      const row = await prisma.invoiceImportBatch.findUnique({ where: { id: req.params.id } });
      if (!row || !isTaxXmlPayload(row.payload)) return res.status(404).json({ error: "Not found" });
      await prisma.invoiceImportBatch.delete({ where: { id: req.params.id } });
      res.status(204).end();
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "delete failed" });
    }
  });

  const stagingSchema = z.object({
    lineInventoryItemId: z.record(z.string()).optional(),
    lineSkuNote: z.record(z.string()).optional(),
    lineSerials: z.record(z.string()).optional(),
    performer: z.string().optional(),
    paymentStatus: z.enum(["PAID", "PENDING"]).optional(),
    paymentMethod: z.enum(["CASH", "BANK"]).optional(),
    bankAccountId: z.string().optional(),
    bankName: z.string().optional(),
    bankAccountNumber: z.string().optional(),
    bankAccountHolder: z.string().optional(),
    bankBranch: z.string().optional(),
    bankLedgerAccountCode: z.string().optional(),
    linePostingKind: z
      .record(z.enum(["WAREHOUSE", "EXPENSE_6421", "EXPENSE_6422", "PREPAID_12M"]))
      .optional(),
  });

  app.patch("/api/e-invoice/batches/:id/staging", requireAuth, async (req, res) => {
    try {
      const parsed = stagingSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
      const row = await prisma.invoiceImportBatch.findUnique({ where: { id: req.params.id } });
      if (!row || !isTaxXmlPayload(row.payload)) return res.status(404).json({ error: "Not found" });
      const pl = row.payload;
      pl.staging = {
        ...pl.staging,
        ...parsed.data,
        lineInventoryItemId: { ...pl.staging.lineInventoryItemId, ...parsed.data.lineInventoryItemId },
        lineSkuNote: { ...pl.staging.lineSkuNote, ...parsed.data.lineSkuNote },
        lineSerials: { ...pl.staging.lineSerials, ...parsed.data.lineSerials },
        linePostingKind: { ...(pl.staging.linePostingKind || {}), ...(parsed.data.linePostingKind || {}) },
      };
      const next = await prisma.invoiceImportBatch.update({
        where: { id: req.params.id },
        data: { payload: pl as object },
      });
      res.json(next);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "patch failed" });
    }
  });

  app.post("/api/e-invoice/batches/:id/validate", requireAuth, async (req, res) => {
    try {
      const row = await prisma.invoiceImportBatch.findUnique({ where: { id: req.params.id } });
      if (!row || !isTaxXmlPayload(row.payload)) return res.status(404).json({ error: "Not found" });
      const pl = row.payload;
      if (pl.parseError || !pl.parsed) {
        return res.status(400).json({ error: "Batch không parse được — không thể xác nhận hợp lệ." });
      }
      const next = await prisma.invoiceImportBatch.update({
        where: { id: req.params.id },
        data: { batchStatus: "VALIDATED" },
      });
      res.json(next);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "validate failed" });
    }
  });

  app.post("/api/e-invoice/batches/:id/mark-posted", requireAuth, async (req, res) => {
    try {
      const body = z.object({ invoiceRef: z.string().optional() }).safeParse(req.body ?? {});
      const row = await prisma.invoiceImportBatch.findUnique({ where: { id: req.params.id } });
      if (!row || !isTaxXmlPayload(row.payload)) return res.status(404).json({ error: "Not found" });
      const pl = row.payload;
      pl.committedAt = new Date().toISOString();
      pl.committedInvoiceRef = body.success ? body.data.invoiceRef : undefined;
      const next = await prisma.invoiceImportBatch.update({
        where: { id: req.params.id },
        data: { batchStatus: "POSTED", payload: pl as object },
      });
      res.json(next);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "mark posted failed" });
    }
  });

  app.post("/api/e-invoice/batches/:id/ai-journal", requireAuth, async (req, res) => {
    try {
      const row = await prisma.invoiceImportBatch.findUnique({ where: { id: req.params.id } });
      if (!row || !isTaxXmlPayload(row.payload)) return res.status(404).json({ error: "Not found" });
      const pl = row.payload;
      if (!pl.parsed) return res.status(400).json({ error: "No parsed invoice" });
      const cls = pl.review?.autoClassification || classifyEInvoice(pl.parsed);
      let suggestion = suggestJournalText(pl.parsed, cls);

      const key = process.env.OPENAI_API_KEY;
      if (key) {
        try {
          const hist = await loadJournalHintsFromState(prisma);
          const prompt = `Bạn là kế toán VN. Dựa trên lịch sử bút toán gợi ý (JSON ngắn) và hóa đơn, đề xuất bút toán 5-8 dòng.\nLịch sử gợi ý: ${JSON.stringify(hist).slice(0, 3500)}\nHóa đơn: ${JSON.stringify(pl.parsed).slice(0, 4000)}`;
          const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: process.env.OPENAI_MODEL || "gpt-4o-mini",
              messages: [
                { role: "system", content: "Trả lời tiếng Việt, súc tích, chỉ nêu Nợ/Có TK và số tiền." },
                { role: "user", content: prompt },
              ],
              max_tokens: 600,
            }),
          });
          if (r.ok) {
            const data = (await r.json()) as any;
            const txt = data?.choices?.[0]?.message?.content;
            if (typeof txt === "string" && txt.trim()) suggestion = txt.trim();
          }
        } catch {
          /* giữ gợi ý rule-based */
        }
      }

      pl.review = { ...pl.review, aiJournalSuggestion: suggestion };
      const next = await prisma.invoiceImportBatch.update({
        where: { id: req.params.id },
        data: { payload: pl as object },
      });
      res.json({ suggestion, batch: next });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "ai failed" });
    }
  });

  const chatSchema = z.object({ message: z.string().min(1) });

  app.post("/api/e-invoice/batches/:id/chat", requireAuth, async (req, res) => {
    try {
      const parsed = chatSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "message required" });
      const row = await prisma.invoiceImportBatch.findUnique({ where: { id: req.params.id } });
      if (!row || !isTaxXmlPayload(row.payload)) return res.status(404).json({ error: "Not found" });
      const pl = row.payload;
      const hist = pl.review?.aiChatHistory || [];
      const userMsg = parsed.data.message;
      let answer = answerInvoiceChat(pl.parsed, userMsg, hist);

      const key = process.env.OPENAI_API_KEY;
      if (key && pl.parsed) {
        try {
          const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: process.env.OPENAI_MODEL || "gpt-4o-mini",
              messages: [
                {
                  role: "system",
                  content:
                    "Bạn trợ lý kế toán. Chỉ trả lời dựa trên dữ liệu hóa đơn JSON được cung cấp. Tiếng Việt.",
                },
                { role: "user", content: `Dữ liệu hóa đơn:\n${JSON.stringify(pl.parsed).slice(0, 6000)}\n\nCâu hỏi: ${userMsg}` },
              ],
              max_tokens: 500,
            }),
          });
          if (r.ok) {
            const data = (await r.json()) as any;
            const txt = data?.choices?.[0]?.message?.content;
            if (typeof txt === "string" && txt.trim()) answer = txt.trim();
          }
        } catch {
          /* rule-based */
        }
      }

      const nextHist = [
        ...hist,
        { role: "user" as const, content: userMsg },
        { role: "assistant" as const, content: answer },
      ].slice(-20);
      pl.review = { ...pl.review, aiChatHistory: nextHist };
      const next = await prisma.invoiceImportBatch.update({
        where: { id: req.params.id },
        data: { payload: pl as object },
      });
      res.json({ answer, batch: next });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "chat failed" });
    }
  });

  app.post(
    "/api/e-invoice/upload",
    requireAuth,
    (req, res, next) => {
      xmlUpload.single("file")(req, res, (err: any) => {
        if (err) return res.status(400).json({ error: String(err.message || err) });
        next();
      });
    },
    async (req, res) => {
      try {
        const f = (req as any).file as Express.Multer.File | undefined;
        if (!f?.buffer) return res.status(400).json({ error: "Thiếu file (field file)" });
        const name = path.basename(f.originalname || "invoice.xml");
        const text = f.buffer.toString("utf8");
        const crypto = await import("node:crypto");
        const hash = crypto.createHash("sha256").update(text, "utf8").digest("hex");
        const existing = await findBatchByRawXmlHash(prisma, hash);
        if (existing) {
          return res.status(409).json({ error: "File XML đã được nhập trước đó (trùng nội dung).", batchId: existing });
        }
        const result = await ingestTaxEInvoiceXml(prisma, { fileName: name, xmlText: text });
        if (!result.ok) return res.status(400).json({ error: result.error });
        await createFileReceivedNotification(
          prisma,
          result.batchId,
          "Đã nhận XML hóa đơn điện tử",
          name,
        );
        res.json({ batchId: result.batchId, payload: result.payload });
      } catch (e: any) {
        res.status(500).json({ error: e?.message || "upload failed" });
      }
    },
  );
}

async function loadJournalHintsFromState(prisma: PrismaClient): Promise<unknown[]> {
  try {
    const row = await prisma.appState.findUnique({ where: { id: 1 } });
    const data = row?.data as Record<string, unknown> | undefined;
    const entries = data?.journalEntries;
    if (!Array.isArray(entries)) return [];
    return entries.slice(-40).map((e: any) => ({
      date: e?.date,
      description: e?.description,
      details: (e?.details || []).slice(0, 12),
    }));
  } catch {
    return [];
  }
}

let watcherStarted = false;

export function startTaxXmlFileWatcher(prisma: PrismaClient) {
  if (watcherStarted) return;
  watcherStarted = true;
  const dir = incomingTaxXmlDir();
  void (async () => {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {}
    console.log(`[e-invoice] Watching tax XML folder: ${dir}`);
    const watcher = chokidar.watch(dir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 1200, pollInterval: 200 },
      depth: 0,
    });
    watcher.on("add", (filePath) => {
      void processIncomingFile(prisma, filePath);
    });
  })();
}

async function processIncomingFile(prisma: PrismaClient, filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".xml") return;
  const base = path.basename(filePath);
  try {
    const text = await fs.readFile(filePath, "utf8");
    const crypto = await import("node:crypto");
    const hash = crypto.createHash("sha256").update(text, "utf8").digest("hex");
    const existing = await findBatchByRawXmlHash(prisma, hash);
    if (existing) {
      console.log(`[e-invoice] skip duplicate file ${base}`);
      return;
    }
    const result = await ingestTaxEInvoiceXml(prisma, { fileName: base, filePath, xmlText: text });
    if (!result.ok) return;
    await createFileReceivedNotification(
      prisma,
      result.batchId,
      "Phát hiện file XML mới trong thư mục theo dõi",
      base,
    );
    console.log(`[e-invoice] ingested ${base} → ${result.batchId}`);
  } catch (e) {
    console.warn(`[e-invoice] failed ${base}:`, e);
  }
}
