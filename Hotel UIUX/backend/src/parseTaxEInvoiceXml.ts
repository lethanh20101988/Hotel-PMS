import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { ParsedEInvoice, ParsedEInvoiceLine } from "./eInvoiceTypes.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
});

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

function num(v: unknown): number {
  const s = str(v).replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Lấy object con bất kể tên gói (DLHDon, HDon, ...) */
function unwrapDl(obj: any): any {
  if (!obj || typeof obj !== "object") return null;
  if (obj.DLHDon) return obj.DLHDon;
  if (obj.HDon && typeof obj.HDon === "object") return unwrapDl(obj.HDon);
  return obj;
}

function pickLinesFromDshh(dshh: any): any[] {
  if (!dshh) return [];
  const raw = dshh.HHDVu ?? dshh.HangHoa ?? dshh.Item ?? dshh.ChiTiet;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function parseVatRatePercent(tsuat: unknown): number {
  const s = str(tsuat).toLowerCase();
  if (!s || s.includes("kct") || s.includes("kkknt")) return 0;
  const m = s.match(/(\d+(?:[.,]\d+)?)/);
  if (m) return num(m[1]);
  return num(tsuat);
}

/**
 * Parse XML hóa đơn điện tử (định dạng phổ biến TT78 / cổng TCT — HDon / DLHDon).
 */
export function parseTaxEInvoiceXml(xmlText: string, companyTaxHint?: string | null): ParsedEInvoice | null {
  let root: any;
  try {
    root = parser.parse(xmlText);
  } catch {
    return null;
  }

  const doc = root?.HDon ?? root?.Invoices?.Invoice ?? root?.Invoice ?? root;
  const dl = unwrapDl(doc);
  if (!dl || typeof dl !== "object") return null;

  const tt = dl.TTChung ?? dl.TTChung2 ?? {};
  const nd = dl.NDHDon ?? dl.NDHDon2 ?? {};

  const formNo = str(tt.KHMSHDon ?? tt.MSHDon);
  const series = str(tt.KHHDon ?? tt.KyHieu);
  const invoiceNumber = str(tt.SHDon ?? tt.SoHoaDon);
  const invoiceDate = str(tt.NLap ?? tt.NgayLap ?? tt.Ngay).split("T")[0];
  const currency = str(tt.DVTTe) || "VND";
  const exchangeRate = num(tt.TGia) || 1;

  const nban = nd.NBan ?? nd.NguoiBan ?? {};
  const nmua = nd.NMua ?? nd.NguoiMua ?? {};

  const sellerName = str(nban.Ten ?? nban.TenNBan);
  const sellerTax = str(nban.MST ?? nban.MSo);
  const sellerAddress = str(nban.DChi);

  const buyerName = str(nmua.Ten ?? nmua.TenNMua);
  const buyerTax = str(nmua.MST ?? nmua.MSo);
  const buyerAddress = str(nmua.DChi);

  const dshh = nd.DSHHDVu ?? nd.HHDVu ?? nd.ChiTietHangHoa;
  const rawLines = pickLinesFromDshh(dshh);

  const lines: ParsedEInvoiceLine[] = [];
  let idx = 0;
  for (const row of rawLines) {
    if (!row || typeof row !== "object") continue;
    const name = str(row.THHDVu ?? row.Ten ?? row.TenHang);
    if (!name) continue;
    const quantity = num(row.SLuong ?? row.SoLuong ?? 1) || 1;
    const price = num(row.DGia ?? row.DonGia);
    const amount = num(row.ThTien ?? row.ThanhTien ?? quantity * price);
    const vatRate = parseVatRatePercent(row.TSuat ?? row.ThueSuat);
    const vatAmount = num(row.TThue ?? row.TienThue ?? (amount * vatRate) / 100);
    idx += 1;
    lines.push({
      lineId: `L${idx}`,
      name,
      unit: str(row.DVTinh ?? row.DVT ?? "—"),
      quantity,
      price: quantity ? amount / quantity : price,
      amount,
      vatRate,
      vatAmount,
    });
  }

  const tToan = nd.TToan ?? nd.TongHop ?? {};
  const totalAmount = num(tToan.TgTCThue ?? tt.TgTCThue ?? lines.reduce((s, l) => s + l.amount, 0));
  const totalVat = num(tToan.TgTThue ?? tt.TgTThue ?? lines.reduce((s, l) => s + l.vatAmount, 0));
  const totalPayment = num(tToan.TgTTTBSo ?? tToan.TgTTTBSo ?? totalAmount + totalVat);

  const normCompany = (companyTaxHint || "").replace(/[^0-9]/g, "");
  const normSeller = sellerTax.replace(/[^0-9]/g, "");
  const normBuyer = buyerTax.replace(/[^0-9]/g, "");
  let direction: "PURCHASE" | "SALES" = "PURCHASE";
  if (normCompany && normSeller === normCompany) direction = "SALES";
  else if (normCompany && normBuyer === normCompany) direction = "PURCHASE";
  else if (normSeller && !normBuyer) direction = "PURCHASE";

  const rawXmlHash = crypto.createHash("sha256").update(xmlText, "utf8").digest("hex");

  if (!invoiceNumber && !formNo && lines.length === 0) return null;

  return {
    sellerName,
    sellerTax,
    sellerAddress,
    buyerName,
    buyerTax,
    buyerAddress,
    formNo,
    symbolCode: series,
    invoiceNumber: invoiceNumber || series || "—",
    invoiceDate: invoiceDate || new Date().toISOString().split("T")[0],
    currency,
    exchangeRate,
    lines,
    totalAmount,
    totalVat,
    totalPayment,
    rawXmlHash,
    direction,
  };
}
