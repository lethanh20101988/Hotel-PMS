import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { notifyStateChanged, DEFAULT_STATE_ROOM_ID } from "./stateSync.js";
import type {
  EInvoiceAutoClass,
  EInvoiceReviewMeta,
  ParsedEInvoice,
  TaxXmlPipelinePayload,
} from "./eInvoiceTypes.js";
import { emptyTaxXmlReview, emptyTaxXmlStaging } from "./eInvoiceTypes.js";
import { parseTaxEInvoiceXml } from "./parseTaxEInvoiceXml.js";

function fingerprint(parsed: ParsedEInvoice): string {
  const p = [
    parsed.sellerTax.replace(/\s/g, ""),
    parsed.buyerTax.replace(/\s/g, ""),
    parsed.symbolCode,
    parsed.formNo,
    parsed.invoiceNumber,
    parsed.invoiceDate,
  ].join("|");
  return crypto.createHash("sha256").update(p, "utf8").digest("hex");
}

export function classifyEInvoice(parsed: ParsedEInvoice): EInvoiceAutoClass {
  const blob = `${parsed.sellerName} ${parsed.buyerName} ${parsed.lines.map((l) => l.name).join(" ")}`.toLowerCase();
  if (/(tài sản|tai san|máy móc|may moc|xe ô tô|ô tô|tscd|tscđ|khấu hao)/i.test(blob)) return "ASSET";
  if (/(công cụ|cong cu|dụng cụ|dung cu|ccdc|153)/i.test(blob)) return "TOOL";
  if (/(dịch vụ|dich vu|phí |phi |bảo hiểm|bao hiem|cước|cuoc|thuê |thue |điện|dien nuoc|nước)/i.test(blob))
    return "EXPENSE";
  return "DEVICE";
}

export function riskWarningsFor(parsed: ParsedEInvoice): string[] {
  const w: string[] = [];
  if (parsed.direction === "PURCHASE" && !parsed.buyerTax?.replace(/\D/g, "")) {
    w.push("Hóa đơn mua vào thiếu MST người mua — kiểm tra trước khi khấu trừ.");
  }
  if (parsed.lines.length === 0) {
    w.push("Không có dòng hàng hóa/dịch vụ trong XML — có thể file không đúng định dạng.");
  }
  const sumNet = parsed.lines.reduce((s, l) => s + l.amount, 0);
  const sumVat = parsed.lines.reduce((s, l) => s + l.vatAmount, 0);
  if (parsed.lines.length > 0 && Math.abs(sumNet - parsed.totalAmount) > 2) {
    w.push("Chênh lệch tổng tiền hàng giữa dòng chi tiết và tổng hợp — cần rà soát.");
  }
  if (parsed.lines.length > 0 && Math.abs(sumVat - parsed.totalVat) > 2) {
    w.push("Chênh lệch tổng thuế giữa dòng chi tiết và tổng hợp — cần rà soát.");
  }
  if (parsed.totalPayment > 0 && parsed.totalPayment % 1_000_000 === 0 && parsed.totalPayment >= 50_000_000) {
    w.push("Giá trị thanh toán tròn triệu lớn — nên đối chiếu chứng từ gốc.");
  }
  return w;
}

export function suggestJournalText(parsed: ParsedEInvoice, cls: EInvoiceAutoClass): string {
  if (parsed.direction === "SALES") {
    return (
      `Gợi ý bút toán bán ra (tham khảo): Nợ 131/1111/1121 — Có 511x (DT) và Có 33311 (thuế GTGT đầu ra).\n` +
      `Tổng thanh toán: ${parsed.totalPayment.toLocaleString("vi-VN")} ${parsed.currency}.`
    );
  }
  const stockAcc = cls === "TOOL" ? "153" : cls === "ASSET" ? "2411/211" : "156";
  const vatAcc = cls === "ASSET" ? "1332" : "1331";
  return (
    `Gợi ý bút toán mua vào (tham khảo — cần điều chỉnh theo hợp đồng/chính sách):\n` +
    `Nợ ${stockAcc} (giá trước thuế), Nợ ${vatAcc} (thuế GTGT được khấu trừ), Có 331/1111/1121 (thanh toán).\n` +
    `Phân loại tự động: ${cls}. Đối tác: ${parsed.sellerName} (MST ${parsed.sellerTax || "—"}).`
  );
}

export async function getCompanyTaxCode(prisma: PrismaClient): Promise<string | null> {
  try {
    const row = await prisma.appState.findUnique({ where: { id: 1 } });
    const data = row?.data as Record<string, unknown> | undefined;
    const ci = data?.companyInfo as Record<string, unknown> | undefined;
    const raw = ci?.taxCode ?? ci?.tax ?? ci?.mst;
    const s = typeof raw === "string" ? raw.replace(/\D/g, "") : "";
    return s || null;
  } catch {
    return null;
  }
}

export async function findBatchByRawXmlHash(prisma: PrismaClient, hash: string): Promise<string | null> {
  const rows = await prisma.invoiceImportBatch.findMany({
    where: { queueStatus: { not: "ERROR" } },
    orderBy: { createdAt: "desc" },
    take: 400,
    select: { id: true, payload: true },
  });
  for (const r of rows) {
    const p = r.payload as TaxXmlPipelinePayload | null;
    if (p?.pipeline === "TAX_XML" && p.parsed?.rawXmlHash === hash) return r.id;
  }
  return null;
}

export async function findDuplicateTaxXmlBatches(
  prisma: PrismaClient,
  fp: string,
  excludeId?: string,
): Promise<string[]> {
  const rows = await prisma.invoiceImportBatch.findMany({
    where: { queueStatus: { not: "ERROR" } },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { id: true, payload: true },
  });
  const hits: string[] = [];
  for (const r of rows) {
    if (excludeId && r.id === excludeId) continue;
    const p = r.payload as TaxXmlPipelinePayload | null;
    if (!p || p.pipeline !== "TAX_XML" || !p.parsed) continue;
    if (fingerprint(p.parsed) === fp) hits.push(r.id);
  }
  return hits;
}

export type IngestXmlResult =
  | { ok: true; batchId: string; payload: TaxXmlPipelinePayload }
  | { ok: false; error: string };

export async function ingestTaxEInvoiceXml(
  prisma: PrismaClient,
  opts: { fileName: string; filePath?: string | null; xmlText: string },
): Promise<IngestXmlResult> {
  const companyTax = await getCompanyTaxCode(prisma);
  const parsed = parseTaxEInvoiceXml(opts.xmlText, companyTax);
  if (!parsed) {
    const payload: TaxXmlPipelinePayload = {
      version: 2,
      pipeline: "TAX_XML",
      sourceFileName: opts.fileName,
      filePath: opts.filePath ?? null,
      detectedAt: new Date().toISOString(),
      parseError: "Không đọc được XML hóa đơn (định dạng không khớp TT78/HDon).",
      review: { ...emptyTaxXmlReview(), riskWarnings: ["Parse XML thất bại — kiểm tra file tải từ cổng TCT."] },
      staging: emptyTaxXmlStaging(),
    };
    const row = await prisma.invoiceImportBatch.create({
      data: {
        fileName: opts.fileName,
        filePath: opts.filePath ?? null,
        queueStatus: "DONE",
        batchStatus: "ERROR",
        payload: payload as object,
      },
    });
    return { ok: true, batchId: row.id, payload };
  }

  const autoClassification = classifyEInvoice(parsed);
  const fp = fingerprint(parsed);
  const duplicateBatchIds = await findDuplicateTaxXmlBatches(prisma, fp);
  const riskWarnings = riskWarningsFor(parsed);
  if (duplicateBatchIds.length > 0) {
    riskWarnings.unshift("Phát hiện hóa đơn trùng fingerprint với batch khác trong hệ thống.");
  }

  const review: EInvoiceReviewMeta = {
    autoClassification,
    duplicateBatchIds,
    duplicateReason: duplicateBatchIds.length ? "Trùng MST + số HĐ + ký hiệu + ngày (hash nội bộ)." : undefined,
    riskWarnings,
    aiJournalSuggestion: suggestJournalText(parsed, autoClassification),
    aiChatHistory: [],
  };

  const payload: TaxXmlPipelinePayload = {
    version: 2,
    pipeline: "TAX_XML",
    sourceFileName: opts.fileName,
    filePath: opts.filePath ?? null,
    detectedAt: new Date().toISOString(),
    parsed,
    review,
    staging: emptyTaxXmlStaging(),
  };

  const row = await prisma.invoiceImportBatch.create({
    data: {
      fileName: opts.fileName,
      filePath: opts.filePath ?? null,
      queueStatus: "DONE",
      batchStatus: "STAGED",
      payload: payload as object,
    },
  });

  return { ok: true, batchId: row.id, payload };
}

export async function createFileReceivedNotification(
  prisma: PrismaClient,
  batchId: string,
  title: string,
  body: string,
) {
  const { enqueueOutboxEvents, buildNotificationOutboxEvent } = await import("./outbox/outboxService.js");
  await prisma.$transaction(async (tx) => {
    const row = await tx.notification.create({
      data: {
        kind: "FILE_RECEIVED",
        title,
        body,
        data: { batchId, pipeline: "TAX_XML" },
      },
    });
    await enqueueOutboxEvents(tx, [
      buildNotificationOutboxEvent({
        notificationId: row.id,
        companyId: DEFAULT_STATE_ROOM_ID,
        kind: "FILE_RECEIVED",
        title,
      }),
    ]);
  });
  notifyStateChanged({ kinds: ["notification", "e-invoice"], companyId: DEFAULT_STATE_ROOM_ID });
}

/** Trả lời chat đơn giản (không gọi API ngoài nếu không cấu hình). */
export function answerInvoiceChat(
  parsed: ParsedEInvoice | undefined,
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
): string {
  const q = question.trim().toLowerCase();
  if (!parsed) {
    return "Chưa có dữ liệu hóa đơn đã parse. Vui lòng chọn batch hợp lệ.";
  }
  if (/(tổng|tong|bao nhiêu|total)/i.test(q) && /(tiền|tien|thanh toán|tt)/i.test(q)) {
    return `Tổng thanh toán trên hóa đơn: ${parsed.totalPayment.toLocaleString("vi-VN")} ${parsed.currency} (Tiền hàng ${parsed.totalAmount.toLocaleString("vi-VN")}, Thuế ${parsed.totalVat.toLocaleString("vi-VN")}).`;
  }
  if (/mst|thuế|tax code/i.test(q)) {
    return `Người bán MST: ${parsed.sellerTax || "—"}. Người mua MST: ${parsed.buyerTax || "—"}.`;
  }
  if (/(số hóa đơn|so hoa don|ký hiệu|ky hieu)/i.test(q)) {
    return `Số: ${parsed.invoiceNumber}, Ký hiệu: ${parsed.symbolCode}, Mẫu số: ${parsed.formNo}, Ngày: ${parsed.invoiceDate}.`;
  }
  if (/(dòng|hang|mặt hàng|mat hang)/i.test(q)) {
    return `Có ${parsed.lines.length} dòng: ${parsed.lines.map((l) => l.name).slice(0, 8).join("; ")}${parsed.lines.length > 8 ? "…" : ""}`;
  }
  if (history.length > 2) {
    return (
      `Dựa trên hóa đơn ${parsed.invoiceNumber} (${parsed.invoiceDate}), câu hỏi "${question.slice(0, 80)}" cần tra cứu chi tiết trên XML hoặc tích hợp AI (OPENAI_API_KEY). ` +
      `Hiện tại hệ thống trả lời theo luật từ khóa; bạn có thể hỏi về tổng tiền, MST, số hóa đơn hoặc danh sách hàng.`
    );
  }
  return (
    `Hóa đơn ${parsed.invoiceNumber} — ${parsed.sellerName} → ${parsed.buyerName}. ` +
    `Bạn hỏi: "${question.slice(0, 120)}". Thử hỏi cụ thể hơn (vd. "Tổng thanh toán là bao nhiêu?", "MST người bán?").`
  );
}
