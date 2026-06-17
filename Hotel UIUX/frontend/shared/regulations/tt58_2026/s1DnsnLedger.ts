import type { AccountingRegimeConfig, FinancialYear, Invoice, JournalEntry, Tt58TaxBookProfile } from '../../types';
import { formatVatRateLabel, vatAmountUnrounded } from '../../utils/vatRate';
import { computeTt58TaxSummary } from './financialStatements';
import {
  getTt58IndustryById,
  getTt58PrimaryIndustryIds,
  resolveTt58IndustryForInvoiceLine,
  TT58_INDUSTRY_GROUP_ORDER,
  usesTt58CitRevenueRateMethod,
  usesTt58VatRevenueRateMethod,
  type Tt58IndustryGroupCode,
} from './tt58IndustryCatalog';

export type Tt58S1DnsnRowKind =
  | 'group_header'
  | 'detail'
  | 'group_subtotal'
  | 'group_vat'
  | 'group_cit'
  | 'footer_vat'
  | 'footer_cit';

export type Tt58S1DnsnLedgerRow = {
  kind: Tt58S1DnsnRowKind;
  docNo?: string;
  docDate?: string;
  description: string;
  amount?: number;
  bold?: boolean;
};

export type Tt58S1DnsnLedgerData = {
  rows: Tt58S1DnsnLedgerRow[];
  totalRevenue: number;
  totalVatPayable: number;
  totalCitPayable: number;
};

export type Tt58RevenueLine = {
  industryId: string;
  vatRate: number;
  citRatePercent: number;
  industryGroup: Tt58IndustryGroupCode;
  industryLabel: string;
  docNo: string;
  docDate: string;
  description: string;
  revenue: number;
  vatAmount: number;
};

export type Tt58IndustryLedgerSection = {
  key: string;
  industryId: string;
  industryGroup: Tt58IndustryGroupCode;
  industryLabel: string;
  vatRate: number;
  bucket: Tt58RevenueLine[];
  groupRevenue: number;
  groupVatInvoices: number;
};

const asInvoices = (invoices: Invoice[] | undefined | null) => (Array.isArray(invoices) ? invoices : []);

const inPeriod = (dateStr: string, startDate: string, endDate: string) =>
  dateStr >= startDate && dateStr <= endDate;

const formatDocDate = (dateStr: string) => {
  const s = String(dateStr || '').slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
};

const usesVatRateMethod = (profile?: Tt58TaxBookProfile) =>
  profile === 'GTGT_RATE_TNDN_RATE' || profile === 'GTGT_RATE_TNDN_INCOME';

const usesCitRateOnRevenue = (profile?: Tt58TaxBookProfile) =>
  profile === 'GTGT_RATE_TNDN_RATE' || profile === 'GTGT_DEDUCT_TNDN_RATE';

const invoicePostingDate = (inv: Invoice) =>
  String(inv.accountingPostingDate || inv.date || '').slice(0, 10);

const buildDescription = (inv: Invoice, detailLabel?: string) => {
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

export const collectTt58RevenueLinesFromInvoices = (
  invoices: Invoice[],
  startDate: string,
  endDate: string,
  regime?: AccountingRegimeConfig,
): Tt58RevenueLine[] => {
  const useVatRevenueRate = usesTt58VatRevenueRateMethod(regime?.tt58TaxBookProfile);
  const lines: Tt58RevenueLine[] = [];
  for (const inv of invoices) {
    if (inv.type !== 'SALES') continue;
    const postDate = invoicePostingDate(inv);
    if (!postDate || !inPeriod(postDate, startDate, endDate)) continue;

    const docNo = String(inv.invoiceNumber || inv.symbolCode || inv.id || '').trim();
    const docDate = formatDocDate(inv.date || postDate);
    const details = Array.isArray(inv.details) ? inv.details : [];

    const pushLine = (detail: Invoice['details'][number] | undefined, revenue: number, vatAmountRaw: number) => {
      if (revenue <= 0 && !String(detail?.productName || inv.description || '').trim()) return;
      const industry = resolveTt58IndustryForInvoiceLine(inv, detail, regime);
      const vatRate = useVatRevenueRate
        ? industry.vatRevenueRatePercent
        : Number.isFinite(Number(detail?.vatRate))
          ? Number(detail?.vatRate)
          : Number(inv.vatRate || 0);
      const citRatePercent = Number(detail?.citRevenueRatePercent ?? industry.citRevenueRatePercent ?? 0);
      const vatAmount = useVatRevenueRate
        ? Math.round((revenue * vatRate) / 100)
        : Number(vatAmountRaw || vatAmountUnrounded(revenue, vatRate));
      lines.push({
        industryId: industry.id,
        vatRate,
        citRatePercent,
        industryGroup: industry.group,
        industryLabel: industry.name,
        docNo,
        docDate,
        description: buildDescription(inv, detail?.productName),
        revenue,
        vatAmount,
      });
    };

    if (details.length === 0) {
      const revenue = Number(inv.amount || 0);
      pushLine(undefined, revenue, Number(inv.vatAmount || 0));
      continue;
    }

    const rates = new Set(details.map((d) => Number(d.vatRate)));
    if (!useVatRevenueRate && rates.size <= 1) {
      const revenue = details.reduce((s, d) => s + Number(d.amount || 0), 0) || Number(inv.amount || 0);
      pushLine(
        details[0],
        revenue,
        Number(inv.vatAmount || details.reduce((s, d) => s + Number(d.vatAmount || 0), 0)),
      );
      continue;
    }

    for (const d of details) {
      pushLine(d, Number(d.amount || 0), Number(d.vatAmount || 0));
    }
  }
  return lines;
};

/** Mỗi ngành nghề = một mục sổ (S1/S2a) khi TT58 % doanh thu hoặc đã khai báo nhiều ngành. */
const shouldSplitTt58LedgerByIndustry = (
  regime?: AccountingRegimeConfig,
  useVatRevenueRate?: boolean,
) => !!useVatRevenueRate || getTt58PrimaryIndustryIds(regime).length > 0;

const tt58VatGroupKey = (
  line: Tt58RevenueLine,
  useVatRevenueRate: boolean,
  regime?: AccountingRegimeConfig,
) =>
  shouldSplitTt58LedgerByIndustry(regime, useVatRevenueRate)
    ? `industry:${line.industryId}`
    : `vat:${line.vatRate}`;

export const buildTt58VatGroupLabel = (
  section: Pick<Tt58IndustryLedgerSection, 'industryLabel' | 'industryGroup' | 'vatRate'>,
  useVatRevenueRate: boolean,
): string => {
  const base = `Nhóm hàng hóa, dịch vụ, ngành nghề ${section.industryLabel}`;
  if (useVatRevenueRate) {
    return `${base} (Nhóm ${section.industryGroup}, GTGT ${section.vatRate}% doanh thu)`;
  }
  return `${base} (${formatVatRateLabel(section.vatRate)} GTGT)`;
};

/** Lập các mục sổ theo từng ngành đã cấu hình (kể cả chưa phát sinh doanh thu). */
export const planTt58IndustryLedgerSections = (
  revenueLines: Tt58RevenueLine[],
  regime?: AccountingRegimeConfig,
  useVatRevenueRate?: boolean,
): Tt58IndustryLedgerSection[] => {
  const splitByIndustry = shouldSplitTt58LedgerByIndustry(regime, useVatRevenueRate);
  const configuredIds = getTt58PrimaryIndustryIds(regime);

  const groups = new Map<string, Tt58RevenueLine[]>();
  for (const line of revenueLines) {
    const key = tt58VatGroupKey(line, !!useVatRevenueRate, regime);
    const bucket = groups.get(key) || [];
    bucket.push(line);
    groups.set(key, bucket);
  }

  if (splitByIndustry && configuredIds.length > 0) {
    for (const id of configuredIds) {
      const key = `industry:${id}`;
      if (!groups.has(key)) groups.set(key, []);
    }
  }

  const sortKeys = (keys: string[]) => {
    if (!splitByIndustry || configuredIds.length === 0) {
      return [...keys].sort((a, b) => {
        if (splitByIndustry) {
          const da = getTt58IndustryById(a.replace('industry:', ''));
          const db = getTt58IndustryById(b.replace('industry:', ''));
          const ga = da?.group || 'A';
          const gb = db?.group || 'A';
          const oa = TT58_INDUSTRY_GROUP_ORDER.indexOf(ga);
          const ob = TT58_INDUSTRY_GROUP_ORDER.indexOf(gb);
          if (oa !== ob) return oa - ob;
          return (da?.name || '').localeCompare(db?.name || '', 'vi');
        }
        return Number(a.split(':')[1] || 0) - Number(b.split(':')[1] || 0);
      });
    }
    const order = new Map(configuredIds.map((id, idx) => [id, idx]));
    return [...keys].sort((a, b) => {
      const ia = order.get(a.replace('industry:', '')) ?? 999;
      const ib = order.get(b.replace('industry:', '')) ?? 999;
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b);
    });
  };

  return sortKeys([...groups.keys()]).map((key) => {
    const bucket = groups.get(key) || [];
    const industryId = splitByIndustry ? key.replace('industry:', '') : bucket[0]?.industryId || '';
    const def = getTt58IndustryById(industryId);
    const sample = bucket[0];
    const vatRate = sample?.vatRate ?? def?.vatRevenueRatePercent ?? Number(key.split(':')[1] || 0);
    return {
      key,
      industryId,
      industryGroup: sample?.industryGroup || def?.group || 'A',
      industryLabel: sample?.industryLabel || def?.name || '—',
      vatRate,
      bucket,
      groupRevenue: bucket.reduce((s, l) => s + l.revenue, 0),
      groupVatInvoices: bucket.reduce((s, l) => s + l.vatAmount, 0),
    };
  });
};

export const computeTt58GroupVat = (
  profile: Tt58TaxBookProfile | undefined,
  groupRevenue: number,
  groupVatFromInvoices: number,
  totalRevenue: number,
  totalVatPayable: number,
) => {
  if (groupRevenue <= 0) return 0;
  if (usesVatRateMethod(profile)) return groupVatFromInvoices;
  if (totalRevenue <= 0) return 0;
  return (totalVatPayable * groupRevenue) / totalRevenue;
};

const computeGroupCit = (
  profile: Tt58TaxBookProfile | undefined,
  bucket: Tt58RevenueLine[],
  groupRevenue: number,
  totalRevenue: number,
  totalCitPayable: number,
) => {
  if (!usesCitRateOnRevenue(profile) || groupRevenue <= 0) return 0;
  if (usesTt58CitRevenueRateMethod(profile)) {
    return bucket.reduce((s, l) => s + (l.revenue * (l.citRatePercent || 0)) / 100, 0);
  }
  if (totalRevenue <= 0) return 0;
  return (totalCitPayable * groupRevenue) / totalRevenue;
};

/** S1-DNSN — sổ doanh thu theo nhóm cùng % thuế GTGT (và TNDN tỷ lệ % nếu profile Điều 5–6). */
export function computeTt58S1DnsnLedger(
  invoicesInput: Invoice[] | undefined | null,
  entriesInput: JournalEntry[] | undefined | null,
  financialYear: FinancialYear,
  profile?: Tt58TaxBookProfile,
  regime?: AccountingRegimeConfig,
): Tt58S1DnsnLedgerData {
  const invoices = asInvoices(invoicesInput);
  const startDate = financialYear.startDate;
  const endDate = financialYear.endDate;
  const tax = computeTt58TaxSummary(entriesInput || [], financialYear);
  const useVatRevenueRate = usesTt58VatRevenueRateMethod(profile);
  const revenueLines = collectTt58RevenueLinesFromInvoices(invoices, startDate, endDate, regime);
  const groupStats = planTt58IndustryLedgerSections(revenueLines, regime, useVatRevenueRate);
  const totalRevenue = groupStats.reduce((s, g) => s + g.groupRevenue, 0);

  const rows: Tt58S1DnsnLedgerRow[] = [];
  let totalVatFromGroups = 0;
  let totalCitFromGroups = 0;

  groupStats.forEach((g, groupIndex) => {
    const { vatRate, bucket, groupRevenue, groupVatInvoices } = g;
    const label = buildTt58VatGroupLabel(g, useVatRevenueRate);
    const sectionNo = groupIndex + 1;

    rows.push({
      kind: 'group_header',
      description: `${sectionNo}. ${label}`,
      bold: true,
    });

    for (const line of bucket) {
      rows.push({
        kind: 'detail',
        docNo: line.docNo,
        docDate: line.docDate,
        description: line.description,
        amount: line.revenue,
      });
    }

    const groupVat = useVatRevenueRate
      ? (groupRevenue * vatRate) / 100
      : computeTt58GroupVat(profile, groupRevenue, groupVatInvoices, totalRevenue, tax.vatOutput);
    const groupCit = computeGroupCit(profile, bucket, groupRevenue, totalRevenue, tax.citExpense);

    rows.push({
      kind: 'group_subtotal',
      description: 'Tổng cộng (1)',
      amount: groupRevenue,
      bold: true,
    });

    if (usesVatRateMethod(profile) || tax.vatOutput > 0) {
      rows.push({ kind: 'group_vat', description: 'Thuế GTGT', amount: groupVat });
      totalVatFromGroups += groupVat;
    }
    if (usesCitRateOnRevenue(profile)) {
      rows.push({ kind: 'group_cit', description: 'Thuế TNDN', amount: groupCit });
      totalCitFromGroups += groupCit;
    }
  });

  if (groupStats.length === 0) {
    rows.push({
      kind: 'group_header',
      description: '1. Nhóm hàng hóa, dịch vụ, ngành nghề (chưa có hóa đơn bán hàng trong kỳ)',
      bold: true,
    });
  }

  if (groupStats.length > 1) {
    rows.push({
      kind: 'group_subtotal',
      description: 'Tổng cộng doanh thu các nhóm',
      amount: totalRevenue,
      bold: true,
    });
  }

  const totalVatPayable = usesVatRateMethod(profile)
    ? (totalVatFromGroups > 0 ? totalVatFromGroups : tax.vatOutput)
    : tax.vatOutput;
  const totalCitPayable = usesCitRateOnRevenue(profile)
    ? (totalCitFromGroups > 0 ? totalCitFromGroups : tax.citExpense)
    : tax.citExpense;

  rows.push({
    kind: 'footer_vat',
    description: 'Tổng số thuế GTGT phải nộp trong kỳ',
    amount: totalVatPayable,
    bold: true,
  });
  rows.push({
    kind: 'footer_cit',
    description: 'Tổng số thuế TNDN phải nộp trong kỳ',
    amount: totalCitPayable,
    bold: true,
  });

  return { rows, totalRevenue, totalVatPayable, totalCitPayable };
};

/** Chuyển sang dòng bảng 4 cột (Số hiệu | Ngày, tháng | Diễn giải | Số tiền). */
export function tt58S1DnsnRowsToTable(
  data: Tt58S1DnsnLedgerData,
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
