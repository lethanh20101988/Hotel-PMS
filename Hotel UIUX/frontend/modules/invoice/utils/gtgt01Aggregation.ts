import type { Invoice, InvoiceDetail } from '@shared/types';
import { getInvoiceTaxDeclarationDate } from '@shared/utils/crossPeriodInvoice';

export type Gtgt01PeriodRange = { from: string; to: string; label: string };

export function monthRange(year: number, month1to12: number): Gtgt01PeriodRange {
  const m = Math.min(12, Math.max(1, month1to12));
  const from = `${year}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(year, m, 0).getDate();
  const to = `${year}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to, label: `Tháng ${m} năm ${year}` };
}

export function quarterRange(year: number, quarter1to4: number): Gtgt01PeriodRange {
  const q = Math.min(4, Math.max(1, quarter1to4));
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const from = `${year}-${String(startMonth).padStart(2, '0')}-01`;
  const last = new Date(year, endMonth, 0).getDate();
  const to = `${year}-${String(endMonth).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to, label: `Quý ${q} năm ${year}` };
}

function lineRows(inv: Invoice): Pick<InvoiceDetail, 'amount' | 'vatRate' | 'vatAmount'>[] {
  if (inv.details && inv.details.length > 0) {
    return inv.details.map(d => ({
      amount: d.amount || 0,
      vatRate: d.vatRate ?? inv.vatRate ?? 0,
      vatAmount: d.vatAmount || 0,
    }));
  }
  return [
    {
      amount: inv.amount || 0,
      vatRate: inv.vatRate ?? 0,
      vatAmount: inv.vatAmount || 0,
    },
  ];
}

function isSupplementaryTaxFiling(inv: Invoice): boolean {
  return !!(inv.taxFilingMeta?.supplementaryFromPriorPeriod || inv.crossPeriodMeta?.supplementaryVat);
}

function invoiceDocumentDateOnly(inv: Invoice): string {
  return String(inv.date || '').split('T')[0];
}

function placeSalesLine(vatRate: number, amount: number, vatAmount: number) {
  const r = Number(vatRate);
  if (!Number.isFinite(r) || r <= 0) {
    return { v26: 0, v29: amount, v30: 0, v31: 0, v32: 0, v33: 0, v32a: 0 };
  }
  if (Math.abs(r - 5) < 0.01) {
    return { v26: 0, v29: 0, v30: amount, v31: vatAmount, v32: 0, v33: 0, v32a: 0 };
  }
  if (Math.abs(r - 10) < 0.01) {
    return { v26: 0, v29: 0, v30: 0, v31: 0, v32: amount, v33: vatAmount, v32a: 0 };
  }
  // 8% hoặc suất khác: đưa vào nhóm 10% kèm thuế dòng — người dùng điều chỉnh nếu cần
  return { v26: 0, v29: 0, v30: 0, v31: 0, v32: amount, v33: vatAmount, v32a: 0 };
}

export interface Gtgt01AggregatedSuggestion {
  /** [23] */
  purchaseValue: number;
  /** [24] */
  purchaseVat: number;
  /** [26] — không tự điền (không phân biệt được KCT vs 0% từ HĐ) */
  salesExempt: number;
  v29: number;
  v30: number;
  v31: number;
  v32: number;
  v33: number;
  v32a: number;
  invoiceCountPurchase: number;
  invoiceCountSales: number;
}

export function aggregateInvoicesForGtgt01(invoices: Invoice[], range: Gtgt01PeriodRange): Gtgt01AggregatedSuggestion {
  const inRange = invoices.filter((inv) => {
    const taxDate = getInvoiceTaxDeclarationDate(inv);
    return taxDate >= range.from && taxDate <= range.to;
  });
  let purchaseValue = 0;
  let purchaseVat = 0;
  let v29 = 0;
  let v30 = 0;
  let v31 = 0;
  let v32 = 0;
  let v33 = 0;
  let v32a = 0;
  let invoiceCountPurchase = 0;
  let invoiceCountSales = 0;

  for (const inv of inRange) {
    const rows = lineRows(inv);
    if (inv.type === 'PURCHASE') {
      invoiceCountPurchase += 1;
      for (const row of rows) {
        purchaseValue += row.amount;
        purchaseVat += row.vatAmount;
      }
    } else {
      invoiceCountSales += 1;
      for (const row of rows) {
        const p = placeSalesLine(row.vatRate, row.amount, row.vatAmount);
        v29 += p.v29;
        v30 += p.v30;
        v31 += p.v31;
        v32 += p.v32;
        v33 += p.v33;
        v32a += p.v32a;
      }
    }
  }

  const round = (n: number) => Math.round(n);
  return {
    purchaseValue: round(purchaseValue),
    purchaseVat: round(purchaseVat),
    salesExempt: 0,
    v29: round(v29),
    v30: round(v30),
    v31: round(v31),
    v32: round(v32),
    v33: round(v33),
    v32a: round(v32a),
    invoiceCountPurchase,
    invoiceCountSales,
  };
}

/** Chỉ HĐ kê khai bổ sung (chứng từ trước kỳ, neo thuế trong kỳ). */
export function aggregateSupplementaryInvoicesForGtgt01(
  invoices: Invoice[],
  range: Gtgt01PeriodRange,
): Gtgt01AggregatedSuggestion {
  const inRange = invoices.filter((inv) => {
    if (!isSupplementaryTaxFiling(inv)) return false;
    const taxDate = getInvoiceTaxDeclarationDate(inv);
    if (taxDate < range.from || taxDate > range.to) return false;
    const docD = invoiceDocumentDateOnly(inv);
    return docD < range.from || docD > range.to;
  });
  return aggregateInvoicesForGtgt01(inRange, {
    ...range,
    label: `${range.label} (bổ sung)`,
  });
}
