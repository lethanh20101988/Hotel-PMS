import type {
  AccountingRegimeConfig,
  FinancialYear,
  Invoice,
  InvoiceDetail,
  JournalEntry,
  Tt58TaxBookProfile,
} from '../../types';
import { computeTt58TaxSummary } from './financialStatements';
import { getTt58IndustryById, resolveTt58IndustryForInvoiceLine } from './tt58IndustryCatalog';

export type Tt58CitRevenueLine = {
  citRatePercent: number;
  docNo: string;
  docDate: string;
  description: string;
  revenue: number;
};

export type Tt58S3aDnsnRowKind =
  | 'opening_cit'
  | 'period_header'
  | 'group_header'
  | 'detail'
  | 'group_subtotal'
  | 'group_cit'
  | 'footer_cit_payable'
  | 'footer_cit_paid'
  | 'footer_cit_closing';

export type Tt58S3aDnsnLedgerRow = {
  kind: Tt58S3aDnsnRowKind;
  docNo?: string;
  docDate?: string;
  description: string;
  amount?: number;
  bold?: boolean;
};

export type Tt58S3aDnsnLedgerData = {
  rows: Tt58S3aDnsnLedgerRow[];
  openingCitPayable: number;
  totalRevenue: number;
  totalCitPayable: number;
  citPaid: number;
  closingCitPayable: number;
};

const usesCitRateOnRevenue = (profile?: Tt58TaxBookProfile) =>
  profile === 'GTGT_RATE_TNDN_RATE' || profile === 'GTGT_DEDUCT_TNDN_RATE';

export const formatTt58CitRateLabel = (ratePercent: number) => `${ratePercent}%`;

export const resolveTt58CitRevenueRatePercent = (
  inv: Invoice,
  detail: InvoiceDetail | undefined,
  regime?: AccountingRegimeConfig,
): number => {
  const fromDetail = Number(detail?.citRevenueRatePercent);
  if (Number.isFinite(fromDetail) && fromDetail >= 0) return fromDetail;
  const fromInv = Number(inv.citRevenueRatePercent);
  if (Number.isFinite(fromInv) && fromInv >= 0) return fromInv;
  const industry = getTt58IndustryById(detail?.tt58IndustryId || inv.tt58IndustryId);
  if (industry) return industry.citRevenueRatePercent;
  if (regime?.standard === 'TT58_2026') {
    return resolveTt58IndustryForInvoiceLine(inv, detail, regime).citRevenueRatePercent;
  }
  const regimeRate = Number(regime?.tt58CitRevenueRatePercent);
  if (Number.isFinite(regimeRate) && regimeRate >= 0) return regimeRate;
  const lineType = String(detail?.type || '').toUpperCase();
  if (lineType === 'SERVICE') return 5;
  if (lineType === 'GOODS' || lineType === 'PRODUCT' || lineType === 'MATERIAL') return 1;
  if (inv.category === 'SERVICE') return 5;
  if (inv.category === 'DEVICE') return 2;
  return 2;
};

const asInvoices = (invoices: Invoice[] | undefined | null) => (Array.isArray(invoices) ? invoices : []);

const inPeriod = (dateStr: string, startDate: string, endDate: string) =>
  dateStr >= startDate && dateStr <= endDate;

const invoicePostingDate = (inv: Invoice) =>
  String(inv.accountingPostingDate || inv.date || '').slice(0, 10);

/** Thu thập doanh thu kèm % thuế TNDN trên doanh thu để nhóm S3a. */
export const collectTt58CitRevenueLines = (
  invoices: Invoice[],
  startDate: string,
  endDate: string,
  regime?: AccountingRegimeConfig,
): Tt58CitRevenueLine[] => {
  const lines: Tt58CitRevenueLine[] = [];
  for (const inv of asInvoices(invoices)) {
    if (inv.type !== 'SALES') continue;
    const postDate = invoicePostingDate(inv);
    if (!postDate || !inPeriod(postDate, startDate, endDate)) continue;

    const docNo = String(inv.invoiceNumber || inv.symbolCode || inv.id || '').trim();
    const docDate = lineDocDate(inv.date || postDate);
    const details = Array.isArray(inv.details) ? inv.details : [];

    if (details.length === 0) {
      const revenue = Number(inv.amount || 0);
      if (revenue <= 0) continue;
      lines.push({
        citRatePercent: resolveTt58CitRevenueRatePercent(inv, undefined, regime),
        docNo,
        docDate,
        description: lineDescription(inv),
        revenue,
      });
      continue;
    }

    for (const d of details) {
      const revenue = Number(d.amount || 0);
      if (revenue <= 0 && !String(d.productName || '').trim()) continue;
      lines.push({
        citRatePercent: resolveTt58CitRevenueRatePercent(inv, d, regime),
        docNo,
        docDate,
        description: lineDescription(inv, d.productName),
        revenue,
      });
    }
  }
  return lines;
};

const lineDocDate = (dateStr: string) => {
  const s = String(dateStr || '').slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
};

const lineDescription = (inv: Invoice, detailLabel?: string) => {
  const base = String(inv.description || '').trim();
  const customer = String(inv.customerName || '').trim();
  const line = String(detailLabel || '').trim();
  const parts = [
    line || undefined,
    base || undefined,
    customer ? `Khách hàng: ${customer}` : undefined,
  ].filter(Boolean);
  return parts.join(' — ') || 'Doanh thu bán hàng hóa, dịch vụ';
};

export const tt58CitGroupKey = (citRatePercent: number) => `cit:${citRatePercent}`;

export const buildTt58CitGroupLabel = (citRatePercent: number): string =>
  `Nhóm hàng hóa, dịch vụ, ngành nghề (thuế TNDN ${formatTt58CitRateLabel(citRatePercent)})`;

const computeGroupCit = (
  profile: Tt58TaxBookProfile | undefined,
  groupRevenue: number,
  citRatePercent: number,
  totalRevenue: number,
  totalCitPayable: number,
) => {
  if (groupRevenue <= 0) return 0;
  if (usesCitRateOnRevenue(profile)) return (groupRevenue * citRatePercent) / 100;
  if (totalRevenue <= 0) return 0;
  return (totalCitPayable * groupRevenue) / totalRevenue;
};

/** S3a-DNSN — sổ doanh thu theo nhóm cùng % thuế TNDN trên doanh thu. */
export function computeTt58S3aDnsnLedger(
  invoicesInput: Invoice[] | undefined | null,
  entriesInput: JournalEntry[] | undefined | null,
  financialYear: FinancialYear,
  profile?: Tt58TaxBookProfile,
  regime?: AccountingRegimeConfig,
): Tt58S3aDnsnLedgerData {
  const startDate = financialYear.startDate;
  const endDate = financialYear.endDate;
  const tax = computeTt58TaxSummary(entriesInput || [], financialYear);
  const revenueLines = collectTt58CitRevenueLines(
    Array.isArray(invoicesInput) ? invoicesInput : [],
    startDate,
    endDate,
    regime,
  );

  const groups = new Map<string, Tt58CitRevenueLine[]>();
  for (const line of revenueLines) {
    const key = tt58CitGroupKey(line.citRatePercent);
    const bucket = groups.get(key) || [];
    bucket.push(line);
    groups.set(key, bucket);
  }

  const sortedKeys = [...groups.keys()].sort((a, b) => {
    const ra = Number(a.split(':')[1] || 0);
    const rb = Number(b.split(':')[1] || 0);
    return ra - rb;
  });

  const groupStats = sortedKeys.map((key) => {
    const bucket = groups.get(key) || [];
    const citRatePercent = Number(key.split(':')[1] || 0);
    const groupRevenue = bucket.reduce((s, l) => s + l.revenue, 0);
    return { citRatePercent, bucket, groupRevenue };
  });
  const totalRevenue = groupStats.reduce((s, g) => s + g.groupRevenue, 0);

  const rows: Tt58S3aDnsnLedgerRow[] = [
    {
      kind: 'opening_cit',
      description: 'Số thuế TNDN còn phải nộp đầu kỳ',
      amount: tax.citOpeningPayable,
      bold: true,
    },
    { kind: 'period_header', description: 'Số phát sinh trong kỳ', bold: true },
  ];

  let totalCitFromGroups = 0;

  groupStats.forEach((g, groupIndex) => {
    const { citRatePercent, bucket, groupRevenue } = g;
    const groupLabel =
      groupStats.length > 1
        ? `${String.fromCharCode(65 + groupIndex)}. ${buildTt58CitGroupLabel(citRatePercent)}`
        : `A. ${buildTt58CitGroupLabel(citRatePercent)}`;

    rows.push({ kind: 'group_header', description: groupLabel, bold: true });

    for (const line of bucket) {
      rows.push({
        kind: 'detail',
        docNo: line.docNo,
        docDate: line.docDate,
        description: line.description,
        amount: line.revenue,
      });
    }

    const groupCit = computeGroupCit(profile, groupRevenue, citRatePercent, totalRevenue, tax.citExpense);

    rows.push({
      kind: 'group_subtotal',
      description: 'Tổng cộng (1)',
      amount: groupRevenue,
      bold: true,
    });
    rows.push({ kind: 'group_cit', description: 'Thuế TNDN', amount: groupCit });
    totalCitFromGroups += groupCit;
  });

  if (groupStats.length === 0) {
    rows.push({
      kind: 'group_header',
      description: 'A. Nhóm hàng hóa, dịch vụ, ngành nghề (chưa có hóa đơn bán hàng trong kỳ)',
      bold: true,
    });
  }

  const totalCitPayable = usesCitRateOnRevenue(profile)
    ? (totalCitFromGroups > 0 ? totalCitFromGroups : tax.citExpense)
    : tax.citExpense;
  const closingCitPayable = tax.citOpeningPayable + totalCitPayable - tax.citPaid;

  rows.push({
    kind: 'footer_cit_payable',
    description: 'Tổng số thuế TNDN phải nộp trong kỳ',
    amount: totalCitPayable,
    bold: true,
  });
  rows.push({
    kind: 'footer_cit_paid',
    description: 'Số thuế TNDN đã nộp trong kỳ',
    amount: tax.citPaid,
    bold: true,
  });
  rows.push({
    kind: 'footer_cit_closing',
    description: 'Số thuế TNDN còn phải nộp cuối kỳ',
    amount: closingCitPayable,
    bold: true,
  });

  return {
    rows,
    openingCitPayable: tax.citOpeningPayable,
    totalRevenue,
    totalCitPayable,
    citPaid: tax.citPaid,
    closingCitPayable,
  };
}

export function tt58S3aDnsnRowsToTable(
  data: Tt58S3aDnsnLedgerData,
  formatAmount: (value: number) => string,
): (string | number)[][] {
  return data.rows.map((row) => {
    if (row.kind === 'detail') {
      return [row.docNo || '', row.docDate || '', row.description, formatAmount(Number(row.amount || 0))];
    }
    if (row.amount != null && Number.isFinite(row.amount)) {
      return ['', '', row.description, formatAmount(row.amount)];
    }
    return ['', '', row.description, ''];
  });
}
