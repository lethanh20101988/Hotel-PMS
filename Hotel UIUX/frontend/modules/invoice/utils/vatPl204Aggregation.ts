import type { Invoice } from '@shared/types';
import type { Gtgt01PeriodRange } from './gtgt01Aggregation';

/** Dòng áp dụng thuế suất GTGT 8% (theo cơ chế giảm từ suất quy định, ví dụ 10% → 8%). */
export function isVatRateEightPercent(vatRate: number): boolean {
  return Math.abs(Number(vatRate) - 8) < 0.02;
}

function detailLikeRows(inv: Invoice): { name: string; amount: number; vatRate: number; vatAmount: number }[] {
  if (inv.details && inv.details.length > 0) {
    return inv.details.map(d => ({
      name: (d.productName || '').trim() || 'Hàng hóa, dịch vụ',
      amount: d.amount || 0,
      vatRate: d.vatRate ?? inv.vatRate ?? 0,
      vatAmount: d.vatAmount || 0,
    }));
  }
  const fallback =
    (inv.description || '').trim() ||
    (inv.type === 'SALES' ? 'Hàng hóa, dịch vụ bán ra' : 'Hàng hóa, dịch vụ mua vào');
  return [
    {
      name: fallback,
      amount: inv.amount || 0,
      vatRate: inv.vatRate ?? 0,
      vatAmount: inv.vatAmount || 0,
    },
  ];
}

export interface Pl204SuggestedPurchaseRow {
  id: string;
  name: string;
  valueExVat: number;
  vatDeductible: number;
}

export interface Pl204SuggestedSalesRow {
  id: string;
  name: string;
  valueExVat: number;
  /** Thuế suất quy định trước giảm (thường 10). */
  ratePrescribed: number;
}

let _idSeq = 0;
function nextId(prefix: string) {
  _idSeq += 1;
  return `${prefix}_${Date.now()}_${_idSeq}`;
}

/** Gom dòng có thuế suất 8% trong kỳ (theo ngày hóa đơn). */
export function suggestPl204RowsFromInvoices(
  invoices: Invoice[],
  range: Gtgt01PeriodRange,
): { purchases: Pl204SuggestedPurchaseRow[]; sales: Pl204SuggestedSalesRow[] } {
  const inRange = invoices.filter(inv => inv.date >= range.from && inv.date <= range.to);
  const purchases: Pl204SuggestedPurchaseRow[] = [];
  const sales: Pl204SuggestedSalesRow[] = [];

  for (const inv of inRange) {
    for (const r of detailLikeRows(inv)) {
      if (!isVatRateEightPercent(r.vatRate)) continue;
      if (inv.type === 'PURCHASE') {
        purchases.push({
          id: nextId('p'),
          name: r.name,
          valueExVat: Math.round(r.amount),
          vatDeductible: Math.round(r.vatAmount),
        });
      } else {
        sales.push({
          id: nextId('s'),
          name: r.name,
          valueExVat: Math.round(r.amount),
          ratePrescribed: 10,
        });
      }
    }
  }

  return { purchases, sales };
}
