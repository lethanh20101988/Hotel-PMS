import type { Invoice } from '@shared/types';

/**
 * Chênh lệch thuế GTGT so với mốc kê khai (đúng − đã kê khai theo loại HĐ).
 * net = Δđầu_ra − Δđầu_vào trên cùng một hóa đơn (một trong hai luôn = 0).
 * net > 0 → CT37 (tăng nghĩa vụ / giảm khấu trừ).
 * net < 0 → CT38 (giảm nghĩa vụ / tăng khấu trừ).
 */
export function classifyVatFilingAdjustment(
  type: 'SALES' | 'PURCHASE',
  correctVat: number,
  comparisonBaselineVat: number,
): { ct37: number; ct38: number; netDelta: number; summary: string } {
  const c = Math.round(Math.max(0, Number(correctVat) || 0));
  const b = Math.round(Math.max(0, Number(comparisonBaselineVat) || 0));
  const dOut = type === 'SALES' ? c - b : 0;
  const dIn = type === 'PURCHASE' ? c - b : 0;
  const net = dOut - dIn;

  if (net > 0) {
    const summary =
      type === 'SALES'
        ? `Thiếu đầu ra / tăng nghĩa vụ so mốc (+${net}) → [37]`
        : `Khai thừa đầu vào / giảm khấu trừ so mốc (+${net}) → [37]`;
    return { ct37: net, ct38: 0, netDelta: net, summary };
  }
  if (net < 0) {
    const abs = -net;
    const summary =
      type === 'SALES'
        ? `Thừa đầu ra / giảm nghĩa vụ so mốc (+${abs}) → [38]`
        : `Thiếu đầu vào / tăng khấu trừ so mốc (+${abs}) → [38]`;
    return { ct37: 0, ct38: abs, netDelta: net, summary };
  }
  return { ct37: 0, ct38: 0, netDelta: 0, summary: 'Không chênh lệch so mốc' };
}

/** Mốc so sánh khi lưu HĐ (ưu tiên thuế đã khai báo trên tờ khai nếu có khóa). */
export function resolveComparisonBaselineBeforeSave(oldInvoice: Invoice | null | undefined): number {
  if (!oldInvoice) return 0;
  const lock = oldInvoice.vatDeclarationLock;
  if (lock?.status === 'DECLARED') {
    const snap = lock.declaredVatAmount;
    if (snap != null && Number.isFinite(Number(snap))) {
      return Math.round(Math.max(0, Number(snap)));
    }
  }
  return Math.round(Math.max(0, Number(oldInvoice.vatAmount || 0)));
}

/** Mốc lưu trên HĐ để tổng hợp 01/GTGT (khóa kê khai hoặc prior đã lưu). */
export function resolveStoredFilingBaselineForAdjustment(inv: Invoice): number {
  const lock = inv.vatDeclarationLock;
  if (lock?.status === 'DECLARED') {
    const snap = lock.declaredVatAmount;
    if (snap != null && Number.isFinite(Number(snap))) {
      return Math.round(Math.max(0, Number(snap)));
    }
  }
  return Math.round(Math.max(0, Number(inv.taxFilingMeta?.filingAdjustmentPriorVat ?? 0)));
}
