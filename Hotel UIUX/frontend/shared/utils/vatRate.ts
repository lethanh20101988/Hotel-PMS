import { roundInvoiceTotalsFromSums, roundVnd } from './vndMoney';

/**
 * Thuế suất đặc biệt: HHDV không chịu thuế GTGT (KCT) — khác VAT 0%.
 * Lưu trong dữ liệu dưới dạng số âm để phân biệt với mức 0% chịu thuế.
 */
export const VAT_RATE_NOT_SUBJECT = -1;

export function effectiveVatPercent(vatRate: number): number {
  const r = Number(vatRate);
  if (!Number.isFinite(r) || r < 0) return 0;
  return r;
}

/** Thuế GTGT trên một dòng (chưa làm tròn đồng) — dùng khi cộng tổng rồi mới round. */
export function vatAmountUnrounded(lineNet: number, vatRate: number): number {
  return (Number(lineNet || 0) * effectiveVatPercent(vatRate)) / 100;
}

export function computeVatAmount(lineAmount: number, vatRate: number): number {
  return roundVnd(vatAmountUnrounded(lineAmount, vatRate));
}

/** Hiển thị nhãn thuế suất (dòng HĐ, bảng kê). */
export function formatVatRateLabel(vatRate: number): string {
  if (Number(vatRate) === VAT_RATE_NOT_SUBJECT) return 'Không chịu thuế';
  return `${vatRate}%`;
}

/** Tổng tiền chưa thuế / thuế / tổng TT: cộng VAT chưa làm tròn theo dòng rồi một lần roundInvoiceTotalsFromSums (đồng bộ với store khi lưu). */
export function recomputeInvoiceHeaderTotals(inv: {
  amount?: unknown;
  vatRate?: unknown;
  details?: Array<{
    quantity?: unknown;
    price?: unknown;
    amount?: unknown;
    vatRate?: unknown;
  }>;
}): { amount: number; vatAmount: number; totalAmount: number } {
  const details = inv.details || [];
  if (details.length > 0) {
    let sumNet = 0;
    let sumVat = 0;
    for (const d of details) {
      const qty = Number(d.quantity || 0);
      const price = Number(d.price || 0);
      const lineAmt = qty && price ? qty * price : Number(d.amount || 0);
      const rawVat = Number(d.vatRate);
      const vatRate = Number.isFinite(rawVat) ? rawVat : 0;
      sumNet += lineAmt;
      sumVat += vatAmountUnrounded(lineAmt, vatRate);
    }
    return roundInvoiceTotalsFromSums(sumNet, sumVat);
  }
  const net = Number(inv.amount || 0);
  const rawVat = Number(inv.vatRate);
  const vatRate = Number.isFinite(rawVat) ? rawVat : 0;
  return roundInvoiceTotalsFromSums(net, vatAmountUnrounded(net, vatRate));
}
