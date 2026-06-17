import type { Invoice } from '@shared/types';
import { getInvoiceTaxDeclarationDate } from '@shared/utils/crossPeriodInvoice';
import {
  classifyVatFilingAdjustment,
  resolveStoredFilingBaselineForAdjustment,
} from '@shared/utils/vatFilingAdjustment';
import type { Gtgt01PeriodRange } from './gtgt01Aggregation';

function invoiceDocumentDate(inv: Invoice): string {
  return String(inv.date || '').split('T')[0];
}

function totalVatRounded(inv: Invoice): number {
  const rows = inv.details?.length
    ? inv.details
    : [{ vatAmount: inv.vatAmount || 0 }];
  let s = 0;
  for (const r of rows) {
    s += Number((r as { vatAmount?: number }).vatAmount || 0);
  }
  return Math.round(s);
}

function isSupplementaryFiling(inv: Invoice): boolean {
  return !!(inv.taxFilingMeta?.supplementaryFromPriorPeriod || inv.crossPeriodMeta?.supplementaryVat);
}

/**
 * Hóa đơn kê khai bổ sung trong `range`: neo thuế trong kỳ, chứng từ phát sinh trước kỳ đó.
 * Phân bổ [37]/[38] theo chênh lệch thuế đúng − mốc (mốc = đã nộp hoặc thuế trước lần lưu).
 */
export function computeSupplementaryCt37Ct38ForRange(
  invoices: Invoice[],
  range: Gtgt01PeriodRange,
): { ct37: number; ct38: number; invoiceCount: number; detail: string[] } {
  const detail: string[] = [];
  let ct37 = 0;
  let ct38 = 0;
  let invoiceCount = 0;

  for (const inv of invoices) {
    if (!isSupplementaryFiling(inv)) continue;
    const taxD = getInvoiceTaxDeclarationDate(inv);
    if (taxD < range.from || taxD > range.to) continue;
    const docD = invoiceDocumentDate(inv);
    if (docD >= range.from && docD <= range.to) continue;

    const vat = totalVatRounded(inv);
    const baseline = resolveStoredFilingBaselineForAdjustment(inv);
    const adj = classifyVatFilingAdjustment(inv.type, vat, baseline);
    if (adj.ct37 <= 0 && adj.ct38 <= 0) continue;

    invoiceCount += 1;
    ct37 += adj.ct37;
    ct38 += adj.ct38;
    const label = inv.invoiceNumber || inv.id;
    if (adj.ct37 > 0) {
      detail.push(`[37+] ${label}: ${adj.summary} (HĐ ${docD}, mốc ${baseline.toLocaleString('vi-VN')})`);
    }
    if (adj.ct38 > 0) {
      detail.push(`[38+] ${label}: ${adj.summary} (HĐ ${docD}, mốc ${baseline.toLocaleString('vi-VN')})`);
    }
  }

  return {
    ct37: Math.round(ct37),
    ct38: Math.round(ct38),
    invoiceCount,
    detail,
  };
}
