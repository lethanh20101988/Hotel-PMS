import type {
  AccountingPeriod,
  FinancialYear,
  Invoice,
  InvoiceCrossPeriodMeta,
  InvoiceTaxFilingMeta,
} from '@shared/types';
import { classifyVatFilingAdjustment } from './vatFilingAdjustment';

export type PriorPeriodMateriality = 'IMMATERIAL' | 'MATERIAL';

export function getPeriodForDate(
  periods: AccountingPeriod[],
  date: string,
): AccountingPeriod | undefined {
  const d = String(date || '').split('T')[0];
  if (!d) return undefined;
  return periods.find((p) => d >= p.startDate && d <= p.endDate);
}

/** Ngày trên chứng từ dùng để xếp bucket niên độ (ưu tiên kỳ hạch toán nếu là HĐ khác niên độ). */
export function getInvoiceFiscalBucketDate(inv: Invoice): string {
  const route = String(inv.accountingPostingDate || inv.date || '').split('T')[0];
  return route || String(inv.date || '').split('T')[0];
}

export function clampDateToFinancialYearBounds(dateStr: string, fy: FinancialYear): string {
  const d = String(dateStr || '').split('T')[0];
  if (!d) return fy.startDate;
  if (d < fy.startDate) return fy.startDate;
  if (d > fy.endDate) return fy.endDate;
  return d;
}

export interface CrossPeriodAnalysis {
  discoveryPostingDate: string;
  isCrossPeriod: boolean;
  originalPeriod: AccountingPeriod | undefined;
  discoveryPeriod: AccountingPeriod | undefined;
  originalHardLocked: boolean;
  outsideFinancialYear: boolean;
  periodStrictlyBeforeDiscovery: boolean;
}

/**
 * Hóa đơn khác niên độ: ngày trên HĐ thuộc kỳ trước so với kỳ đang hạch toán,
 * hoặc nằm ngoài niên độ kế toán đang mở (phát hiện/ghi tại niên độ hiện tại).
 */
export function analyzeCrossPeriodInvoice(
  invoiceDocumentDate: string,
  financialYear: FinancialYear,
  accountingPeriods: AccountingPeriod[],
  discoveryAnchorDate?: string,
): CrossPeriodAnalysis {
  const doc = String(invoiceDocumentDate || '').split('T')[0];
  const anchorRaw = String(discoveryAnchorDate || new Date().toISOString().split('T')[0]).split('T')[0];
  const discoveryPostingDate = clampDateToFinancialYearBounds(anchorRaw, financialYear);

  const origP = getPeriodForDate(accountingPeriods, doc);
  const discP = getPeriodForDate(accountingPeriods, discoveryPostingDate);

  const outsideFinancialYear =
    doc.length >= 10 && (doc < financialYear.startDate || doc > financialYear.endDate);

  const periodStrictlyBeforeDiscovery =
    !!origP &&
    !!discP &&
    origP.endDate.localeCompare(discP.startDate) < 0;

  const isCrossPeriod = outsideFinancialYear || periodStrictlyBeforeDiscovery;

  const originalHardLocked =
    !!origP && origP.status === 'CLOSED' && origP.lockType === 'HARD';

  return {
    discoveryPostingDate,
    isCrossPeriod,
    originalPeriod: origP,
    discoveryPeriod: discP,
    originalHardLocked,
    outsideFinancialYear,
    periodStrictlyBeforeDiscovery,
  };
}

/** Khác niên độ hoặc kỳ gốc khóa cứng → hạch toán tại kỳ phát hiện. */
export function isFullCrossPeriodPosting(analysis: CrossPeriodAnalysis): boolean {
  return (
    analysis.outsideFinancialYear ||
    (analysis.periodStrictlyBeforeDiscovery && analysis.originalHardLocked)
  );
}

/**
 * Cùng niên độ, kỳ sổ trước kỳ hiện tại nhưng kỳ gốc không khóa cứng:
 * sổ kế toán theo ngày HĐ, thuế kê tại kỳ phát hiện.
 */
export function isSameFyLateTaxFilingOnly(analysis: CrossPeriodAnalysis): boolean {
  return (
    analysis.periodStrictlyBeforeDiscovery &&
    !analysis.outsideFinancialYear &&
    !analysis.originalHardLocked
  );
}

export function invoicePeriodKeyFromDate(dateStr: string): string {
  const d = String(dateStr || '').split('T')[0];
  return d.length >= 7 ? d.slice(0, 7) : d;
}

export function buildInvoiceTaxFilingMeta(params: {
  type: 'SALES' | 'PURCHASE';
  vatAmount: number;
  /** Mốc thuế đã kê khai / trước lần lưu (đúng − mốc → [37] hoặc [38]). */
  comparisonBaselineVat: number;
  invoiceDocumentDate: string;
  filingAnchorDate: string;
  originPeriod?: AccountingPeriod;
  filingPeriod?: AccountingPeriod;
  split: 'SAME_FY_LATE_TAX' | 'CROSS_FY_OR_LOCKED';
  auditAction: string;
  auditDetail: string;
}): InvoiceTaxFilingMeta {
  const now = new Date().toISOString();
  const vat = Math.round(Math.max(0, Number(params.vatAmount || 0)));
  const adj = classifyVatFilingAdjustment(params.type, vat, params.comparisonBaselineVat);
  const suggestedCt37Delta = adj.ct37 > 0 ? adj.ct37 : undefined;
  const suggestedCt38Delta = adj.ct38 > 0 ? adj.ct38 : undefined;
  const detail = `${params.auditDetail}; ${adj.summary}`;
  return {
    supplementaryFromPriorPeriod: true,
    invoicePeriodKey: invoicePeriodKeyFromDate(params.invoiceDocumentDate),
    filingAnchorDate: params.filingAnchorDate,
    originPeriodLabel: params.originPeriod?.name,
    filingPeriodLabel: params.filingPeriod?.name,
    accountingTaxSplit: params.split,
    filingAdjustmentNetDelta: adj.netDelta === 0 ? undefined : adj.netDelta,
    suggestedCt37Delta,
    suggestedCt38Delta,
    auditTrail: [{ at: now, action: params.auditAction, detail: detail }],
  };
}

export function buildCrossPeriodMeta(
  analysis: CrossPeriodAnalysis,
  materiality: PriorPeriodMateriality,
  hasVat: boolean,
  auditDetail: string,
): InvoiceCrossPeriodMeta {
  const now = new Date().toISOString();
  return {
    discoveryPostingDate: analysis.discoveryPostingDate,
    materiality,
    supplementaryVat: hasVat && analysis.isCrossPeriod,
    originalPeriodName: analysis.originalPeriod?.name,
    discoveryPeriodName: analysis.discoveryPeriod?.name,
    auditTrail: [{ at: now, action: 'GHI_NHAN', detail: auditDetail }],
  };
}

/** Ngày dùng cho tờ khai / tổng hợp VAT (ưu tiên neo kỳ kê khai, rồi ngày hạch toán, rồi ngày HĐ). */
export function getInvoiceTaxDeclarationDate(inv: Invoice): string {
  const d = String(inv.vatFilingAnchorDate || inv.accountingPostingDate || inv.date || '').split('T')[0];
  return d;
}
